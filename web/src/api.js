// Appel de l'API conso.boris.sh via le relais OptiWatt (server/), ou directement
import { parseApiResponse } from './data.js';

export const DEFAULT_API = 'https://conso.boris.sh';

/**
 * Récupère la courbe de charge (puissance moyenne par pas de 30 min, en W).
 * @param {{prm: string, token: string, dateDebut: string, dateFin: string, baseUrl?: string}} p
 */
export async function fetchLoadCurve({ prm, token, dateDebut, dateFin, baseUrl }) {
  const base = (baseUrl || DEFAULT_API).replace(/\/+$/, '');
  const url = `${base}/api/courbe_de_charge_consommation?` +
    new URLSearchParams({ pointId: prm, dateDebut, dateFin });

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  } catch {
    throw new Error(
      baseUrl
        ? "Le relais est injoignable. Vérifiez son URL dans les paramètres avancés, ou réessayez dans quelques minutes."
        : "L'appel direct à conso.boris.sh est bloqué par le navigateur (CORS). Renseignez l'URL du relais dans les paramètres avancés (voir la documentation)."
    );
  }

  let body = null;
  try { body = await res.json(); } catch { /* corps non JSON */ }

  if (!res.ok) {
    const detail = body?.message ? ` (${body.message})` : '';
    const messages = {
      400: 'Requête invalide : vérifiez le PRM (14 chiffres) et les dates',
      401: "Token invalide ou sans accès à ce PRM",
      403: 'Accès refusé',
      429: 'Trop de requêtes',
    };
    throw new Error((messages[res.status] ?? `Erreur ${res.status} côté Enedis ou conso.boris.sh, réessayez plus tard`) + detail);
  }

  const { points } = parseApiResponse(body);
  points.fromRelayCache = res.headers.get('X-OptiWatt-Cache') === 'HIT';
  if (!points.length) throw new Error('Aucune donnée sur cette période (Enedis publie les données de la veille chaque matin).');
  return points;
}
