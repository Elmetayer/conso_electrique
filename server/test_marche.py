"""Tests des prix day-ahead (ENTSO-E) : python -m pytest server"""

import json
import threading
import urllib.request
from datetime import date, datetime, timezone

import pytest
from http.server import ThreadingHTTPServer

import main
import marche
from test_main import ORIGIN, get

NS = "urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3"
XML = f"""<?xml version="1.0" encoding="utf-8"?>
<Publication_MarketDocument xmlns="{NS}">
  <TimeSeries>
    <Period>
      <timeInterval><start>2026-11-19T23:00Z</start><end>2026-11-20T01:00Z</end></timeInterval>
      <resolution>PT60M</resolution>
      <Point><position>1</position><price.amount>99</price.amount></Point>
      <Point><position>2</position><price.amount>88</price.amount></Point>
    </Period>
  </TimeSeries>
  <TimeSeries>
    <Period>
      <timeInterval><start>2026-11-19T23:00Z</start><end>2026-11-20T00:00Z</end></timeInterval>
      <resolution>PT15M</resolution>
      <Point><position>1</position><price.amount>70.5</price.amount></Point>
      <Point><position>3</position><price.amount>-5</price.amount></Point>
    </Period>
  </TimeSeries>
</Publication_MarketDocument>""".encode()

ACK = b"""<Acknowledgement_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-1:acknowledgementdocument:7:0">
<Reason><code>999</code><text>No matching data found for Data item Day-ahead Prices</text></Reason>
</Acknowledgement_MarketDocument>"""


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def test_heure_de_paris():
    assert marche.utc_to_paris(utc(2026, 11, 19, 23, 0)) == datetime(2026, 11, 20, 0, 0)
    assert marche.utc_to_paris(utc(2026, 7, 1, 22, 0)) == datetime(2026, 7, 2, 0, 0)
    # passages à l'heure d'été (29/03/2026) et d'hiver (25/10/2026) à 01:00 UTC
    assert marche.utc_to_paris(utc(2026, 3, 29, 0, 59)) == datetime(2026, 3, 29, 1, 59)
    assert marche.utc_to_paris(utc(2026, 3, 29, 1, 0)) == datetime(2026, 3, 29, 3, 0)
    assert marche.utc_to_paris(utc(2026, 10, 25, 1, 0)) == datetime(2026, 10, 25, 2, 0)
    assert marche.paris_to_utc(datetime(2026, 11, 1)) == utc(2026, 10, 31, 23, 0)
    assert marche.paris_to_utc(datetime(2026, 4, 1)) == utc(2026, 3, 31, 22, 0)


def test_mois():
    assert marche.months_between(date(2026, 10, 26), date(2026, 12, 1)) == ["2026-10", "2026-11"]
    assert marche.months_between(date(2025, 12, 31), date(2026, 1, 2)) == ["2025-12", "2026-01"]
    assert marche.month_bounds("2026-11") == (utc(2026, 10, 31, 23, 0), utc(2026, 11, 30, 23, 0))


def test_lecture_xml_courbe_a03_et_resolution_fine():
    p = marche.parse_prices(XML)
    # 00:00-01:00 Paris : la série 15 min l'emporte, la position 2 manquante prolonge la 1, la 4 prolonge la 3
    assert [p[utc(2026, 11, 19, 23, m)] for m in (0, 15, 30, 45)] == [70.5, 70.5, -5, -5]
    # 01:00-02:00 Paris : seule la série horaire existe, répétée sur 4 quarts d'heure
    assert [p[utc(2026, 11, 20, 0, m)] for m in (0, 15, 30, 45)] == [88] * 4
    assert len(p) == 8


def test_aucune_donnee():
    assert marche.parse_prices(ACK) == {}


def test_fetch_month_en_heure_de_paris(monkeypatch):
    class Res:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def read(self): return XML
    seen = {}
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout: seen.setdefault("url", req.full_url) and Res())
    pts = marche.fetch_month("2026-11", "tok")
    assert "periodStart=202610312300" in seen["url"] and "periodEnd=202611302300" in seen["url"]
    assert pts[0] == ["2026-11-20T00:00", 70.5] and pts[-1] == ["2026-11-20T01:45", 88]


def test_duree_de_cache():
    assert main.price_ttl("2026-10", date(2026, 11, 23)) == 30 * 86400
    assert main.price_ttl("2026-11", date(2026, 11, 23)) == 3600
    assert main.price_ttl("2026-10", date(2026, 11, 1)) == 3600  # mois tout juste terminé


@pytest.fixture()
def server(monkeypatch):
    main._prices.clear()
    main._hits.clear()
    calls = []

    def fake_month(month, token):
        calls.append(month)
        return [[f"{month}-01T00:00", 50.0], [f"{month}-20T23:45", 60.0]]

    monkeypatch.setattr(marche, "fetch_month", fake_month)
    monkeypatch.setattr(main, "ENTSOE_TOKEN", "tok")
    srv = ThreadingHTTPServer(("127.0.0.1", 0), main.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", calls
    srv.shutdown()


def test_route_prix_puis_cache(server):
    base, calls = server
    path = "/api/prix_day_ahead?debut=2026-10-20&fin=2026-11-21"
    s1, h1, b1 = get(base, path, {"Origin": ORIGIN})
    s2, h2, _ = get(base, path, {"Origin": ORIGIN})
    body = json.loads(b1)
    assert (s1, s2) == (200, 200) and h1["X-OptiWatt-Cache"] == "MISS" and h2["X-OptiWatt-Cache"] == "HIT"
    assert calls == ["2026-10", "2026-11"]
    # filtrage sur [debut, fin[ : le 01/10 est exclu, le 01/11 et le 20/11 inclus
    assert body["points"] == [["2026-10-20T23:45", 60.0], ["2026-11-01T00:00", 50.0], ["2026-11-20T23:45", 60.0]]
    assert body["source"].startswith("ENTSO-E") and body["pas"] == 15


def test_route_prix_erreurs(server, monkeypatch):
    base, _ = server
    assert get(base, "/api/prix_day_ahead?debut=2026-11-21&fin=2026-11-20", {"Origin": ORIGIN})[0] == 400
    assert get(base, "/api/prix_day_ahead?debut=2020-01-01&fin=2026-01-01", {"Origin": ORIGIN})[0] == 400
    assert get(base, "/api/prix_day_ahead?debut=2026-11-01&fin=2026-11-02", {"Origin": "https://evil.example"})[0] == 403
    monkeypatch.setattr(main, "ENTSOE_TOKEN", "")
    assert get(base, "/api/prix_day_ahead?debut=2026-11-01&fin=2026-11-02", {"Origin": ORIGIN})[0] == 503
