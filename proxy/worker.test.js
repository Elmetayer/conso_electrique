// Test du proxy avec un fetch simulé : node --test proxy/worker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const env = { ALLOWED_ORIGINS: 'https://elmetayer.github.io' };
const req = (path, init = {}) => new Request(`https://proxy.example${path}`, init);

test('refuse une origine non autorisée', async () => {
  const res = await worker.fetch(req('/api/courbe_de_charge_consommation', { headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(res.status, 403);
});

test('répond au preflight', async () => {
  const res = await worker.fetch(req('/api/x', { method: 'OPTIONS', headers: { Origin: 'https://elmetayer.github.io' } }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://elmetayer.github.io');
});

test('rejette un type inconnu', async () => {
  const res = await worker.fetch(req('/api/../../admin', { headers: { Origin: 'https://elmetayer.github.io', Authorization: 'Bearer t' } }), env);
  assert.equal(res.status, 404);
});

test('relaie la requête et ajoute CORS', async () => {
  let called;
  globalThis.fetch = async (url, init) => { called = { url, init }; return new Response('{"grandeur":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const res = await worker.fetch(req('/api/courbe_de_charge_consommation?pointId=1&dateDebut=2026-01-01&dateFin=2026-01-02', {
    headers: { Origin: 'https://elmetayer.github.io', Authorization: 'Bearer abc' },
  }), env);
  assert.equal(res.status, 200);
  assert.equal(called.url, 'https://conso.boris.sh/api/courbe_de_charge_consommation?pointId=1&dateDebut=2026-01-01&dateFin=2026-01-02');
  assert.equal(called.init.headers.Authorization, 'Bearer abc');
  assert.match(called.init.headers['User-Agent'], /OptiWatt/);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://elmetayer.github.io');
});
