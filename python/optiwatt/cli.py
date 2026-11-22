"""Ligne de commande : optiwatt fetch | summary"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from .api import ApiError, fetch_load_curve
from .data import parse_enedis_csv, summarize, to_csv


def _cmd_fetch(args) -> int:
    token = args.token or os.environ.get("CONSO_TOKEN")
    if not token:
        print("Token manquant : --token ou variable CONSO_TOKEN", file=sys.stderr)
        return 2
    end = args.end or date.today()
    start = args.start or end - timedelta(days=7)
    if start >= end:
        print("--start doit précéder --end", file=sys.stderr)
        return 2

    def progress(i, n, a, b):
        print(f"[{i}/{n}] {a} → {b}", file=sys.stderr)

    try:
        points = fetch_load_curve(args.prm, token, start, end, pause=args.pause, base_url=args.base_url, progress=progress)
    except ApiError as e:
        print(f"Erreur : {e}", file=sys.stderr)
        return 1
    csv = to_csv(points)
    if args.output:
        Path(args.output).write_text(csv, encoding="utf-8")
        print(f"{len(points)} mesures écrites dans {args.output}", file=sys.stderr)
    else:
        sys.stdout.write(csv)
    return 0


def _cmd_summary(args) -> int:
    s = summarize(parse_enedis_csv(Path(args.file).read_text(encoding="utf-8-sig")))
    print(f"Période        : {s['from']} → {s['to']} ({s['days']} j, pas {s['step_min']:g} min)")
    print(f"Énergie        : {s['energy_kwh']:.1f} kWh ({s['avg_kwh_per_day']:.1f} kWh/jour)")
    print(f"Pic            : {s['peak_w']:.0f} W le {s['peak_at']}")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="optiwatt", description="Courbe de charge Linky via conso.boris.sh")
    sub = p.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fetch", help="récupère la courbe de charge et l'écrit en CSV")
    f.add_argument("--prm", required=True, help="PRM / PDL (14 chiffres)")
    f.add_argument("--token", help="token conso.boris.sh (sinon $CONSO_TOKEN)")
    f.add_argument("--start", type=date.fromisoformat, help="début inclus AAAA-MM-JJ (défaut : fin - 7 j)")
    f.add_argument("--end", type=date.fromisoformat, help="fin exclue AAAA-MM-JJ (défaut : aujourd'hui)")
    f.add_argument("-o", "--output", help="fichier CSV de sortie (défaut : stdout)")
    f.add_argument("--pause", type=float, default=1.0, help="pause entre deux appels, en secondes")
    f.add_argument("--base-url", default="https://conso.boris.sh")
    f.set_defaults(func=_cmd_fetch)

    s = sub.add_parser("summary", help="indicateurs clés d'un CSV")
    s.add_argument("file")
    s.set_defaults(func=_cmd_summary)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
