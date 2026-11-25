"""Prix day-ahead et consommation France depuis la plateforme de transparence ENTSO-E.

- Requête « Day-ahead prices » (documentType A44) sur la zone France.
- Requête « Actual Total Load » (documentType A65, processType A16) : consommation
  nationale réalisée, en MW. Elle sert à pondérer le prix moyen du marché comme on
  pondère le prix capté par une consommation individuelle.
- Réponse XML : séries (TimeSeries) > périodes (Period) avec un début UTC, une
  résolution (PT15M depuis octobre 2025, PT60M avant) et des points numérotés.
  Les points répétés peuvent être omis (courbe « A03 ») : on prolonge alors la
  valeur précédente.
- Tout est ramené sur une grille de 15 minutes, horodatée en heure murale de
  Paris (début de l'intervalle), comme la courbe de charge Linky.
- Les requêtes sont découpées par mois civil pour que le cache du relais soit
  partagé entre utilisateurs.

Bibliothèque standard uniquement (pas de zoneinfo : la règle d'heure d'été
européenne est codée ci-dessous).
"""

from __future__ import annotations

import os
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone

ENTSOE_URL = os.environ.get("ENTSOE_URL", "https://web-api.tp.entsoe.eu/api")
ZONE_FR = "10YFR-RTE------C"
STEP = timedelta(minutes=15)


class MarketError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


# ---------- Heure de Paris ----------

def _last_sunday(year: int, month: int) -> date:
    d = date(year, month + 1, 1) - timedelta(days=1) if month < 12 else date(year, 12, 31)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def paris_offset(utc: datetime) -> timedelta:
    """+2 h entre le dernier dimanche de mars et le dernier dimanche d'octobre (à 01:00 UTC), +1 h sinon."""
    y = utc.year
    start = datetime.combine(_last_sunday(y, 3), datetime.min.time(), timezone.utc) + timedelta(hours=1)
    end = datetime.combine(_last_sunday(y, 10), datetime.min.time(), timezone.utc) + timedelta(hours=1)
    return timedelta(hours=2) if start <= utc < end else timedelta(hours=1)


def paris_to_utc(local: datetime) -> datetime:
    """Heure murale de Paris (naïve) -> UTC. Pour l'heure ambiguë d'octobre, prend la première."""
    guess = local.replace(tzinfo=timezone.utc) - timedelta(hours=2)
    if guess + paris_offset(guess) == local.replace(tzinfo=timezone.utc):
        return guess
    return local.replace(tzinfo=timezone.utc) - timedelta(hours=1)


def utc_to_paris(utc: datetime) -> datetime:
    return (utc + paris_offset(utc)).replace(tzinfo=None)


# ---------- Découpage par mois ----------

def months_between(debut: date, fin: date) -> list[str]:
    """Mois 'AAAA-MM' couvrant [debut, fin[."""
    out, y, m = [], debut.year, debut.month
    while date(y, m, 1) < fin:
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def month_bounds(month: str) -> tuple[datetime, datetime]:
    """Bornes UTC du mois civil en heure de Paris."""
    y, m = int(month[:4]), int(month[5:7])
    nxt = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return (paris_to_utc(datetime(y, m, 1)), paris_to_utc(datetime(nxt.year, nxt.month, 1)))


# ---------- Lecture du XML ENTSO-E ----------

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find(el: ET.Element, name: str) -> ET.Element | None:
    return next((c for c in el if _local(c.tag) == name), None)


def _text(el: ET.Element, *path: str) -> str | None:
    for name in path:
        el = _find(el, name) if el is not None else None
    return el.text.strip() if el is not None and el.text else None


def _parse_utc(s: str) -> datetime:
    s = s.replace("Z", "")
    return datetime.strptime(s[:16], "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)


RESOLUTIONS = {"PT15M": 15, "PT30M": 30, "PT60M": 60}


def parse_prices(xml_bytes: bytes) -> dict[datetime, float]:
    """XML A44 -> {début UTC du quart d'heure: prix €/MWh}. Les séries les plus fines l'emportent."""
    return parse_series(xml_bytes, "price.amount")


def parse_load(xml_bytes: bytes) -> dict[datetime, float]:
    """XML A65 -> {début UTC du quart d'heure: consommation France en MW}."""
    return parse_series(xml_bytes, "quantity")


def parse_series(xml_bytes: bytes, field: str) -> dict[datetime, float]:
    """Série temporelle ENTSO-E ramenée au quart d'heure (valeur `field` de chaque point)."""
    root = ET.fromstring(xml_bytes)
    kind = _local(root.tag)
    if kind == "Acknowledgement_MarketDocument":
        reason = " ".join(e.text or "" for e in root.iter() if _local(e.tag) == "text")
        if "No matching data" in reason:
            return {}
        raise MarketError(502, f"ENTSO-E : {reason.strip() or 'réponse inattendue'}")
    by_res: dict[int, dict[datetime, float]] = {}
    for ts in (e for e in root.iter() if _local(e.tag) == "TimeSeries"):
        for period in (c for c in ts if _local(c.tag) == "Period"):
            start = _text(period, "timeInterval", "start")
            end = _text(period, "timeInterval", "end")
            res = RESOLUTIONS.get(_text(period, "resolution") or "")
            if not (start and end and res):
                continue
            t0, t1 = _parse_utc(start), _parse_utc(end)
            n = int((t1 - t0) / timedelta(minutes=res))
            values: dict[int, float] = {}
            for pt in (c for c in period if _local(c.tag) == "Point"):
                pos, price = _text(pt, "position"), _text(pt, field)
                if pos and price:
                    values[int(pos)] = float(price)
            target = by_res.setdefault(res, {})
            last = None
            for pos in range(1, n + 1):  # courbe A03 : valeur prolongée si point absent
                last = values.get(pos, last)
                if last is None:
                    continue
                slot = t0 + (pos - 1) * timedelta(minutes=res)
                for q in range(res // 15):
                    target[slot + q * STEP] = last
    merged: dict[datetime, float] = {}
    for res in sorted(by_res, reverse=True):  # 60 puis 30 puis 15 : la plus fine écrase
        merged.update(by_res[res])
    return merged


# ---------- Appel ----------

def _get(params: dict, token: str) -> bytes:
    query = urllib.parse.urlencode({"securityToken": token, **params})
    req = urllib.request.Request(f"{ENTSOE_URL}?{query}",
                                 headers={"User-Agent": "OptiWatt-relay (+https://github.com/Elmetayer/conso_electrique)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.read()
    except urllib.error.HTTPError as e:
        body = e.read()
        if e.code == 401:
            raise MarketError(502, "Token ENTSO-E refusé (variable ENTSOE_TOKEN du relais)") from e
        if e.code == 429:
            raise MarketError(503, "ENTSO-E limite le nombre de requêtes, réessayez dans une minute") from e
        if b"Acknowledgement_MarketDocument" not in body:
            raise MarketError(502, f"ENTSO-E indisponible (HTTP {e.code})") from e
        return body
    except (urllib.error.URLError, TimeoutError) as e:
        raise MarketError(502, f"ENTSO-E injoignable ({e})") from e


def fetch_month(month: str, token: str) -> list[list]:
    """Un mois au pas de 15 min : [[heure murale 'AAAA-MM-JJTHH:MM', prix €/MWh, conso France MW ou None], …].

    La consommation est facultative : si ENTSO-E ne la fournit pas, les prix sont renvoyés seuls.
    """
    t0, t1 = month_bounds(month)
    period = {"periodStart": t0.strftime("%Y%m%d%H%M"), "periodEnd": t1.strftime("%Y%m%d%H%M")}
    prices = parse_prices(_get({"documentType": "A44", "in_Domain": ZONE_FR, "out_Domain": ZONE_FR, **period}, token))
    try:
        load = parse_load(_get({"documentType": "A65", "processType": "A16", "outBiddingZone_Domain": ZONE_FR, **period}, token))
    except MarketError:
        load = {}
    return [[utc_to_paris(t).strftime("%Y-%m-%dT%H:%M"), round(p, 2), None if t not in load else round(load[t])]
            for t, p in sorted(prices.items()) if t0 <= t < t1]
