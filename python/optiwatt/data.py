"""Parsing et agrégation — même logique que web/src/data.js.

Les horodatages Enedis marquent la FIN de l'intervalle de mesure : on retire
1 minute avant de calculer l'heure de rattachement. Les dates sont en heure
murale (heure locale française écrite dans la donnée), sans fuseau.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import median

_TS_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?")
_TS_FR = re.compile(r"^(\d{2})/(\d{2})/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?")


@dataclass(frozen=True)
class Point:
    t: datetime  # fin d'intervalle, heure murale
    v: float  # puissance moyenne (W)


def parse_timestamp(raw: str) -> datetime | None:
    s = str(raw or "").strip().strip('"')
    if m := _TS_ISO.match(s):
        y, mo, d, h, mi, se = m.groups()
        return datetime(int(y), int(mo), int(d), int(h), int(mi), int(se or 0))
    if m := _TS_FR.match(s):
        d, mo, y, h, mi, se = m.groups()
        return datetime(int(y), int(mo), int(d), int(h), int(mi), int(se or 0))
    return None


def parse_number(raw) -> float | None:
    if raw is None:
        return None
    s = re.sub(r"\s", "", str(raw).strip().strip('"')).replace(",", ".")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def parse_enedis_csv(text: str) -> list[Point]:
    """Lit un export CSV Enedis (en-tête libre puis 'Horodate;Valeur')."""
    lines = text.lstrip("﻿").splitlines()
    sep = ";" if any(";" in line for line in lines) else ","
    start = next((i + 1 for i, l in enumerate(lines) if l.split(sep)[0].strip().strip('"').lower() == "horodate"), 0)
    points = []
    for line in lines[start:]:
        cells = line.split(sep)
        if len(cells) < 2:
            continue
        t, v = parse_timestamp(cells[0]), parse_number(cells[1])
        if t is not None and v is not None:
            points.append(Point(t, v))
    if not points:
        raise ValueError("Aucune mesure reconnue (colonnes « Horodate » et « Valeur » attendues).")
    return sorted(points, key=lambda p: p.t)


def parse_api_response(payload: dict) -> list[Point]:
    """Lit la réponse conso.boris.sh (format 2026 : grandeur[0].points[{d, v}])."""
    grandeur = (payload.get("grandeur") or [{}])[0]
    raw = [(p.get("d"), p.get("v")) for p in grandeur.get("points", [])]
    if not raw:  # ancien format
        raw = [(p.get("date"), p.get("value")) for p in payload.get("interval_reading", [])]
    points = [Point(t, v) for d, val in raw if (t := parse_timestamp(d)) and (v := parse_number(val)) is not None]
    return sorted(points, key=lambda p: p.t)


def aggregate(points: list[Point], agg: str = "mean", cap: float | None = None, step: int = 60) -> list[dict]:
    """Agrège par (jour, créneau de `step` minutes : 30 ou 60). agg = 'mean' ou 'max' ; cap = plafond en W."""
    groups: dict[tuple[str, int], list[float]] = defaultdict(list)
    for p in points:
        s = p.t - timedelta(minutes=1)
        groups[(s.date().isoformat(), (s.hour * 60 + s.minute) // step)].append(p.v)
    rows = []
    for (date, slot), values in sorted(groups.items()):
        raw = max(values) if agg == "max" else sum(values) / len(values)
        capped = bool(cap) and raw > cap
        rows.append({"date": date, "slot": slot, "hour": slot * step // 60, "minute": slot * step % 60,
                     "raw": raw, "value": cap if capped else raw, "capped": capped})
    return rows


def aggregate_hourly(points: list[Point], agg: str = "mean", cap: float | None = None) -> list[dict]:
    """Agrégation par heure (compatibilité)."""
    return [{k: r[k] for k in ("date", "hour", "raw", "value", "capped")} for r in aggregate(points, agg, cap, 60)]


def summarize(points: list[Point]) -> dict:
    if not points:
        raise ValueError("Aucune mesure")
    step = median((b.t - a.t).total_seconds() / 60 for a, b in zip(points, points[1:])) if len(points) > 1 else 30
    energy_kwh = sum(p.v for p in points) * step / 60 / 1000
    peak = max(points, key=lambda p: p.v)
    first = (points[0].t - timedelta(minutes=1)).date()
    last = (points[-1].t - timedelta(minutes=1)).date()
    days = (last - first).days + 1
    return {
        "from": first.isoformat(),
        "to": last.isoformat(),
        "days": days,
        "step_min": step,
        "energy_kwh": energy_kwh,
        "avg_kwh_per_day": energy_kwh / days,
        "peak_w": peak.v,
        "peak_at": peak.t.isoformat(sep=" "),
    }


def to_csv(points: list[Point]) -> str:
    """CSV réimportable dans l'application web (format espace client Enedis)."""
    def fmt(v: float) -> str:
        return str(int(v)) if float(v).is_integer() else str(v)

    return "Horodate;Valeur\n" + "".join(f"{p.t:%Y-%m-%dT%H:%M:%S};{fmt(p.v)}\n" for p in points)
