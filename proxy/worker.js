// OptiWatt – proxy CORS minimal vers https://conso.boris.sh
// Relaie GET /api/<type>?... avec l'en-tête Authorization, et ajoute les en-têtes CORS
// pour les origines autorisées. Ne stocke ni ne journalise aucune donnée.

const UPSTREAM = 'https://conso.boris.sh';
const TYPES = new Set([
  'index_consommation', 'index_production', 'consommation_quotidienne', 'production_quotidienne',
  'puissance_conso_max_quotidienne', 'courbe_de_charge_consommation', 'courbe_de_charge_production',
]);

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin);
  return ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Accept',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : null;
}

const json = (status, message, headers = {}) =>
  new Response(JSON.stringify({ status, message }), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (!cors) return json(403, 'Origine non autorisée');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json(405, 'Seule la méthode GET est autorisée', cors);

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/([a-z_]+)$/);
    if (!match || !TYPES.has(match[1])) return json(404, 'Type de données inconnu', cors);
    const auth = request.headers.get('Authorization');
    if (!auth) return json(400, "En-tête 'Authorization' manquant", cors);

    const upstream = await fetch(`${UPSTREAM}/api/${match[1]}${url.search}`, {
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        'User-Agent': env.USER_AGENT || 'OptiWatt-proxy (+https://github.com/Elmetayer/conso_electrique)',
      },
    });
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    headers.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
