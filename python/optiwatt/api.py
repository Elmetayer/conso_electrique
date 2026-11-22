"""Client minimal pour https://conso.boris.sh (bibliothèque standard uniquement)."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta

from .data import Point, parse_api_response

BASE_URL = "https://conso.boris.sh"
USER_AGENT = "OptiWatt-cli/0.1 (+https://github.com/Elmetayer/conso_electrique)"
MAX_DAYS = 7  # limite Enedis pour la courbe de charge


class ApiError(RuntimeError):
    pass


def _get(path: str, params: dict, token: str, base_url: str = BASE_URL) -> dict:
    url = f"{base_url.rstrip('/')}/api/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        try:
            detail = json.load(e).get("message", "")
        except Exception:  # noqa: BLE001
            detail = ""
        messages = {400: "Requête invalide (PRM ou dates)", 401: "Token invalide ou sans accès à ce PRM"}
        raise ApiError(f"{messages.get(e.code, f'Erreur {e.code}')} {detail}".strip()) from e


def date_chunks(start: date, end: date, size: int = MAX_DAYS):
    """Découpe [start, end[ en tranches d'au plus `size` jours."""
    cur = start
    while cur < end:
        nxt = min(cur + timedelta(days=size), end)
        yield cur, nxt
        cur = nxt


def fetch_load_curve(prm: str, token: str, start: date, end: date, *, pause: float = 1.0,
                     base_url: str = BASE_URL, progress=None) -> list[Point]:
    """Courbe de charge sur [start, end[, découpée en tranches de 7 jours espacées de `pause` s."""
    points: list[Point] = []
    chunks = list(date_chunks(start, end))
    for i, (a, b) in enumerate(chunks):
        if progress:
            progress(i + 1, len(chunks), a, b)
        payload = _get("courbe_de_charge_consommation",
                       {"pointId": prm, "dateDebut": a.isoformat(), "dateFin": b.isoformat()}, token, base_url)
        points.extend(parse_api_response(payload))
        if i < len(chunks) - 1:
            time.sleep(pause)
    return sorted(set(points), key=lambda p: p.t)
