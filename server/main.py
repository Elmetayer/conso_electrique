"""OptiWatt – relais Python vers https://conso.boris.sh (déployable sur Railway).

Rôle : permettre au site statique (GitHub Pages) d'appeler conso.boris.sh malgré
l'absence d'en-têtes CORS, tout en restant « bon citoyen » vis-à-vis du service :

- seuls GET /api/<type> vers les types Conso API sont relayés ;
- CORS limité aux origines de ALLOWED_ORIGINS ;
- User-Agent identifiant OptiWatt, comme le demande conso.boris.sh ;
- cache mémoire : une même requête (type + paramètres + token) n'est envoyée
  qu'une fois toutes les CACHE_HOURS heures ; au plus CACHE_MAX_ENTRIES entrées,
  les plus anciennes étant supprimées en premier ;
- limite de RATE_LIMIT requêtes amont par heure et par IP cliente ;
- une page de blocage (HTML Cloudflare) est convertie en erreur JSON explicite.

Il sert aussi les prix day-ahead France (GET /api/prix_day_ahead?debut=&fin=),
lus sur la plateforme ENTSO-E avec le token ENTSOE_TOKEN (voir marche.py) :
mis en cache par mois, 30 jours pour un mois terminé, 1 heure sinon.

Aucune donnée n'est écrite sur disque ni journalisée (ni PRM, ni token).
Bibliothèque standard uniquement.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from collections import OrderedDict
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import date, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import marche

UPSTREAM = os.environ.get("UPSTREAM", "https://conso.boris.sh")
ALLOWED_ORIGINS = {o.strip() for o in os.environ.get(
    "ALLOWED_ORIGINS", "https://elmetayer.github.io,http://localhost:5173,http://localhost:4173").split(",") if o.strip()}
USER_AGENT = os.environ.get("USER_AGENT", "OptiWatt-relay/0.1 (+https://github.com/Elmetayer/conso_electrique)")
CACHE_HOURS = float(os.environ.get("CACHE_HOURS", "12"))
CACHE_MAX_ENTRIES = int(os.environ.get("CACHE_MAX_ENTRIES", "1000"))  # ~15 Ko/entrée -> ~15 Mo
RATE_LIMIT = int(os.environ.get("RATE_LIMIT", "30"))
TYPES = {
    "index_consommation", "index_production", "consommation_quotidienne", "production_quotidienne",
    "puissance_conso_max_quotidienne", "courbe_de_charge_consommation", "courbe_de_charge_production",
}
ENTSOE_TOKEN = os.environ.get("ENTSOE_TOKEN", "")
MARKET_RATE_LIMIT = int(os.environ.get("MARKET_RATE_LIMIT", "60"))  # mois récupérés auprès d'ENTSO-E par heure et par IP
MARKET_MAX_MONTHS = 37
PATH_RE = re.compile(r"^/api/([a-z_]+)$")

_cache: OrderedDict[str, tuple[float, int, bytes]] = OrderedDict()  # ordre d'insertion = du plus ancien au plus récent
_hits: dict[str, list[float]] = {}
_prices: dict[str, tuple[float, list]] = {}  # mois 'AAAA-MM' -> (horodatage, points)
_lock = threading.Lock()


def cache_key(api_type: str, query: str, auth: str) -> str:
    return hashlib.sha256(f"{api_type}?{query}|{auth}".encode()).hexdigest()


def cache_store(key: str, status: int, body: bytes, now: float) -> None:
    """Ajoute une réponse, purge les entrées expirées puis applique le plafond."""
    ttl = CACHE_HOURS * 3600
    with _lock:
        _cache.pop(key, None)
        _cache[key] = (now, status, body)
        while _cache:  # les plus anciennes sont en tête
            oldest_key, (ts, _, _) = next(iter(_cache.items()))
            if now - ts >= ttl or len(_cache) > CACHE_MAX_ENTRIES:
                del _cache[oldest_key]
            else:
                break


def allow_request(client: str, now: float | None = None, limit: int | None = None) -> bool:
    """Fenêtre glissante d'une heure par IP cliente."""
    now = now or time.time()
    limit = RATE_LIMIT if limit is None else limit
    with _lock:
        hits = [t for t in _hits.get(client, []) if now - t < 3600]
        if len(hits) >= limit:
            _hits[client] = hits
            return False
        hits.append(now)
        _hits[client] = hits
        return True


def fetch_upstream(api_type: str, query: str, auth: str) -> tuple[int, bytes]:
    req = urllib.request.Request(
        f"{UPSTREAM}/api/{api_type}?{query}",
        headers={"Authorization": auth, "Accept": "application/json", "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        body = e.read()
        if body.lstrip()[:1] not in (b"{", b"["):  # page HTML (pare-feu Cloudflare, erreur proxy…)
            blocked = b"Attention Required" in body or b"blocked" in body
            message = ("Requête bloquée par le pare-feu de conso.boris.sh (IP du relais bloquée)"
                       if blocked else f"Réponse inattendue de conso.boris.sh (HTTP {e.code})")
            body = json.dumps({"status": e.code, "message": message, "upstream_blocked": blocked}).encode()
        return e.code, body
    except (urllib.error.URLError, TimeoutError) as e:
        return 502, json.dumps({"status": 502, "message": f"conso.boris.sh injoignable ({e})"}).encode()


def price_ttl(month: str, today: date) -> float:
    """Un mois terminé depuis plus de 2 jours ne change plus : 30 jours de cache, sinon 1 heure."""
    y, m = int(month[:4]), int(month[5:7])
    nxt = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return 30 * 86400 if today >= nxt + timedelta(days=2) else 3600


def get_prices(debut: date, fin: date, client: str, now: float | None = None) -> tuple[list, str]:
    """Prix au pas de 15 min sur [debut, fin[ (heure de Paris), via le cache mensuel."""
    now = now or time.time()
    today = datetime.fromtimestamp(now).date()
    points, origin = [], "HIT"
    for month in marche.months_between(debut, fin):
        with _lock:
            hit = _prices.get(month)
        if hit and now - hit[0] < price_ttl(month, today):
            month_points = hit[1]
        else:
            if not allow_request("marche:" + client, now, MARKET_RATE_LIMIT):
                raise marche.MarketError(429, "Limite de requêtes de prix atteinte, réessayez plus tard")
            month_points = marche.fetch_month(month, ENTSOE_TOKEN)
            origin = "MISS"
            with _lock:
                _prices[month] = (now, month_points)
        points.extend(month_points)
    lo, hi = debut.isoformat(), fin.isoformat()
    return [p for p in points if lo <= p[0][:10] < hi], origin


def parse_range(query: str) -> tuple[date, date]:
    q = parse_qs(query)
    try:
        debut = date.fromisoformat(q["debut"][0])
        fin = date.fromisoformat(q["fin"][0])
    except (KeyError, ValueError) as e:
        raise marche.MarketError(400, "Paramètres 'debut' et 'fin' attendus au format AAAA-MM-JJ") from e
    if fin <= debut:
        raise marche.MarketError(400, "'fin' doit être postérieure à 'debut'")
    if len(marche.months_between(debut, fin)) > MARKET_MAX_MONTHS:
        raise marche.MarketError(400, "Période trop longue (3 ans maximum)")
    return debut, fin


class Handler(BaseHTTPRequestHandler):
    server_version = "OptiWatt-relay"

    def log_message(self, *args):  # pas de journal (les URL contiennent le PRM)
        pass

    def _cors(self) -> dict[str, str] | None:
        origin = self.headers.get("Origin", "")
        if "*" in ALLOWED_ORIGINS or origin in ALLOWED_ORIGINS:
            return {
                "Access-Control-Allow-Origin": origin or "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Accept",
                "Access-Control-Max-Age": "86400",
                "Access-Control-Expose-Headers": "X-OptiWatt-Cache",
                "Vary": "Origin",
            }
        return None

    def _send(self, status: int, body: bytes, headers: dict[str, str] | None = None, cache: str = ""):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if cache:
            self.send_header("X-OptiWatt-Cache", cache)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, message: str, headers=None):
        self._send(status, json.dumps({"status": status, "message": message}).encode(), headers)

    def do_OPTIONS(self):
        cors = self._cors()
        if cors is None:
            return self._json(403, "Origine non autorisée")
        self.send_response(204)
        for k, v in cors.items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path in ("/", "/healthz"):
            return self._json(200, "OptiWatt relay OK")

        cors = self._cors()
        if cors is None:
            return self._json(403, "Origine non autorisée")
        if url.path == "/api/prix_day_ahead":
            return self._serve_prices(url.query, cors)
        m = PATH_RE.match(url.path)
        if not m or m.group(1) not in TYPES:
            return self._json(404, "Type de données inconnu", cors)
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return self._json(400, "En-tête 'Authorization' manquant", cors)

        key = cache_key(m.group(1), url.query, auth)
        now = time.time()
        with _lock:
            hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_HOURS * 3600:
            return self._send(hit[1], hit[2], cors, cache="HIT")

        client = (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()
        if not allow_request(client, now):
            return self._json(429, f"Limite de {RATE_LIMIT} requêtes par heure atteinte, réessayez plus tard", cors)

        status, body = fetch_upstream(m.group(1), url.query, auth)
        if status == 200:
            cache_store(key, status, body, now)
        self._send(status, body, cors, cache="MISS")


    def _serve_prices(self, query: str, cors: dict[str, str]):
        if not ENTSOE_TOKEN:
            return self._json(503, "Les prix de marché ne sont pas configurés sur ce relais (ENTSOE_TOKEN)", cors)
        client = (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()
        try:
            debut, fin = parse_range(query)
            points, origin = get_prices(debut, fin, client)
        except marche.MarketError as e:
            return self._json(e.status, str(e), cors)
        body = {
            "source": "ENTSO-E Transparency Platform",
            "zone": "FR",
            "unite": "EUR/MWh",
            "pas": 15,
            "horodatage": "début d'intervalle, heure de Paris",
            "points": points,
        }
        self._send(200, json.dumps(body, separators=(",", ":")).encode(), cors, cache=origin)


def main():
    port = int(os.environ.get("PORT", "8787"))
    print(f"OptiWatt relay sur le port {port} — origines autorisées : {', '.join(sorted(ALLOWED_ORIGINS))}"
          f" — prix ENTSO-E : {'activés' if ENTSOE_TOKEN else 'non configurés'}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
