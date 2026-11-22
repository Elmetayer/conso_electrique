from datetime import date

import pytest

from optiwatt import aggregate_hourly, parse_api_response, parse_enedis_csv, summarize, to_csv
from optiwatt.api import date_chunks
from optiwatt.cli import main

CSV = """Identifiant PRM;Type de donnees;Date de debut;Date de fin
12345678901234;Courbe de charge;01/04/2026;02/04/2026
Horodate;Valeur
2026-04-01T00:30:00+02:00;400
2026-04-01T01:00:00+02:00;600
2026-04-01T01:30:00+02:00;13000
2026-04-01T02:00:00+02:00;1000
2026-04-01T02:30:00+02:00;
"""


def test_parse_csv():
    pts = parse_enedis_csv(CSV)
    assert len(pts) == 4 and pts[0].v == 400


def test_parse_csv_invalide():
    with pytest.raises(ValueError):
        parse_enedis_csv("a;b\nc;d")


def test_aggregate_mean_et_plafond():
    pts = parse_enedis_csv(CSV)
    assert [(r["hour"], r["value"]) for r in aggregate_hourly(pts)] == [(0, 500), (1, 7000)]
    rows = aggregate_hourly(pts, agg="max", cap=6000)
    assert rows[1] == {"date": "2026-04-01", "hour": 1, "raw": 13000, "value": 6000, "capped": True}


def test_api_format_2026():
    pts = parse_api_response({"grandeur": [{"unite": "W", "points": [
        {"d": "2026-04-01 01:00:00", "v": "250"}, {"d": "2026-04-01 00:30:00", "v": "200"}, {"d": "x", "v": None}]}]})
    assert [p.v for p in pts] == [200, 250]


def test_summary_et_csv_aller_retour():
    pts = parse_enedis_csv(CSV)
    s = summarize(pts)
    assert s["step_min"] == 30 and s["peak_w"] == 13000 and s["days"] == 1
    assert s["energy_kwh"] == pytest.approx(15000 * 0.5 / 1000)
    assert parse_enedis_csv(to_csv(pts)) == pts


def test_date_chunks():
    chunks = list(date_chunks(date(2026, 10, 1), date(2026, 10, 20)))
    assert chunks[0] == (date(2026, 10, 1), date(2026, 10, 8))
    assert chunks[-1] == (date(2026, 10, 15), date(2026, 10, 20))
    assert len(chunks) == 3


def test_cli_summary(tmp_path, capsys):
    f = tmp_path / "c.csv"
    f.write_text(CSV, encoding="utf-8")
    assert main(["summary", str(f)]) == 0
    assert "13000 W" in capsys.readouterr().out


def test_aggregate_pas_30_min():
    from optiwatt.data import aggregate
    rows = aggregate(parse_enedis_csv(CSV), step=30)
    assert [(r["hour"], r["minute"], r["value"]) for r in rows] == [(0, 0, 400), (0, 30, 600), (1, 0, 13000), (1, 30, 1000)]
