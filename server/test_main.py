"""Tests du relais : python -m pytest server"""

import io
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

import main

ORIGIN = "https://elmetayer.github.io"
URL_PATH = "/api/courbe_de_charge_consommation?pointId=12345678901234&dateDebut=2026-11-15&dateFin=2026-11-22"


@pytest.fixture()
def server(monkeypatch):
    main._cache.clear()
    main._hits.clear()
    calls = []

    def fake_upstream(api_type, query, auth):
        calls.append((api_type, query, auth))
        return 200, b'{"grandeur": []}'

    monkeypatch.setattr(main, "fetch_upstream", fake_upstream)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), main.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", calls
    srv.shutdown()


def get(base, path, headers=None, method="GET"):
    req = urllib.request.Request(base + path, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def test_healthz(server):
    status, _, body = get(server[0], "/healthz")
    assert status == 200 and b"OK" in body


def test_origine_refusee(server):
    status, _, body = get(server[0], URL_PATH, {"Origin": "https://evil.example", "Authorization": "Bearer t"})
    assert status == 403 and json.loads(body)["message"] == "Origine non autorisée"


def test_preflight(server):
    status, headers, _ = get(server[0], URL_PATH, {"Origin": ORIGIN}, method="OPTIONS")
    assert status == 204 and headers["Access-Control-Allow-Origin"] == ORIGIN


def test_type_inconnu_et_token_manquant(server):
    assert get(server[0], "/api/admin", {"Origin": ORIGIN, "Authorization": "Bearer t"})[0] == 404
    assert get(server[0], URL_PATH, {"Origin": ORIGIN})[0] == 400


def test_relai_puis_cache(server):
    base, calls = server
    h = {"Origin": ORIGIN, "Authorization": "Bearer abc"}
    s1, h1, b1 = get(base, URL_PATH, h)
    s2, h2, _ = get(base, URL_PATH, h)
    assert (s1, s2) == (200, 200)
    assert h1["X-OptiWatt-Cache"] == "MISS" and h2["X-OptiWatt-Cache"] == "HIT"
    assert h1["Access-Control-Allow-Origin"] == ORIGIN
    assert len(calls) == 1 and calls[0][0] == "courbe_de_charge_consommation" and calls[0][2] == "Bearer abc"


def test_limite_par_ip(monkeypatch):
    main._hits.clear()
    monkeypatch.setattr(main, "RATE_LIMIT", 2)
    assert main.allow_request("1.2.3.4", 1000) and main.allow_request("1.2.3.4", 1001)
    assert not main.allow_request("1.2.3.4", 1002)
    assert main.allow_request("1.2.3.4", 1000 + 3601)  # fenêtre glissante


def test_page_de_blocage_convertie(monkeypatch):
    html = b"<!DOCTYPE html><title>Attention Required! | Cloudflare</title>"
    err = urllib.error.HTTPError("u", 403, "Forbidden", {}, io.BytesIO(html))
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(err))
    status, body = main.fetch_upstream("courbe_de_charge_consommation", "x=1", "Bearer t")
    data = json.loads(body)
    assert status == 403 and data["upstream_blocked"] is True and "bloquée" in data["message"]
