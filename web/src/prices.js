// Prix de gros day-ahead France (ENTSO-E via le relais) et valorisation de la consommation.
//
// Conventions (cf. data.js) : heures murales stockées en UTC dans des Date.
// - Prix : horodatage = DÉBUT du quart d'heure.
// - Courbe Linky : horodatage = FIN de l'intervalle (t - pas → t).
// Le prix d'une mesure est la moyenne des quarts d'heure qui la composent.

import { isoDay, parseTimestamp, stepMinutes } from './data.js';

const Q = 15 * 60_000;

/** Réponse du relais -> Map(ms du début du quart d'heure -> €/MWh). Doublons (heure d'hiver) moyennés. */
export function parsePriceResponse(json) {
  const acc = new Map();
  for (const [ts, p] of json?.points ?? []) {
    const t = parseTimestamp(ts);
    if (!t || !Number.isFinite(p)) continue;
    const a = acc.get(t.getTime());
    if (a) { a.sum += p; a.n += 1; } else acc.set(t.getTime(), { sum: p, n: 1 });
  }
  return new Map([...acc].map(([k, a]) => [k, a.sum / a.n]));
}

/** Ajoute à chaque mesure son prix moyen `p` (€/MWh), ou null si un quart d'heure manque. */
export function attachPrices(points, prices) {
  const step = stepMinutes(points);
  const quarters = Math.max(1, Math.round(step / 15));
  return points.map((pt) => {
    const start = pt.t.getTime() - step * 60_000;
    let sum = 0;
    for (let i = 0; i < quarters; i++) {
      const v = prices.get(start + i * Q);
      if (v === undefined) return { ...pt, p: null };
      sum += v;
    }
    return { ...pt, p: sum / quarters };
  });
}

/** Coût en € d'une mesure (puissance moyenne v en W sur `step` minutes, prix p en €/MWh). */
export const costOf = (v, p, step) => (v * (step / 60) / 1e6) * p;

/**
 * Indicateurs « marché » sur les mesures valorisées.
 * - prix capté = coût / énergie (prix moyen pondéré par la conso)
 * - prix moyen du marché = moyenne simple des prix sur les mêmes intervalles
 * - facteur de forme = prix capté / prix moyen (> 1 : conso aux heures chères)
 */
export function summarizeMarket(points) {
  const step = stepMinutes(points);
  let mwh = 0; let cost = 0; let psum = 0; let n = 0;
  for (const { v, p } of points) {
    if (p == null) continue;
    const e = (v * (step / 60)) / 1e6;
    mwh += e; cost += e * p; psum += p; n += 1;
  }
  if (!n || mwh <= 0) return null;
  const captured = cost / mwh;
  const market = psum / n;
  return { energyKWh: mwh * 1000, cost, captured, market, shape: captured / market, coverage: n / points.length };
}

/** Bornes de la requête de prix [debut, fin[ couvrant toutes les mesures. */
export function priceRange(points) {
  const first = new Date(points[0].t.getTime() - 60_000);
  const last = new Date(points[points.length - 1].t.getTime() - 60_000);
  return { debut: isoDay(first), fin: isoDay(new Date(last.getTime() + 86_400_000)) };
}

/** Prix fictifs (pour les données d'exemple) : profil journalier + saison + quelques pics et prix négatifs. */
export function demoPrices(points) {
  const prices = new Map();
  if (!points.length) return prices;
  const { debut, fin } = priceRange(points);
  let s = 7;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const end = parseTimestamp(`${fin} 00:00`).getTime();
  let dayFactor = 1;
  for (let t = parseTimestamp(`${debut} 00:00`).getTime(); t < end; t += Q) {
    const d = new Date(t);
    const h = d.getUTCHours() + d.getUTCMinutes() / 60;
    if (h === 0) dayFactor = 0.8 + 0.45 * rand() + (rand() < 0.04 ? 1.2 : 0);
    const doy = (t - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000;
    const winter = Math.max(0, Math.cos((2 * Math.PI * (doy - 15)) / 365));
    const weekend = [0, 6].includes(d.getUTCDay());
    const solar = Math.max(0, Math.sin((Math.PI * (h - 7)) / 12)) * (1 - winter) * (weekend ? 80 : 60);
    let p = 55 + 45 * winter;
    if (h >= 7 && h < 10) p += 40 + 20 * winter;
    if (h >= 18 && h < 21) p += 60 + 50 * winter;
    p = p * dayFactor - solar + 8 * (rand() - 0.5);
    prices.set(t, Math.round(p * 100) / 100);
  }
  return prices;
}

/** Récupère les prix auprès du relais OptiWatt. */
export async function fetchDayAhead({ baseUrl, debut, fin }) {
  if (!baseUrl) throw new Error("Prix de marché indisponibles : aucune URL de relais n'est configurée (paramètres avancés de l'onglet API).");
  const url = `${baseUrl.replace(/\/+$/, '')}/api/prix_day_ahead?${new URLSearchParams({ debut, fin })}`;
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json' } }); }
  catch { throw new Error('Prix de marché : le relais est injoignable.'); }
  let body = null;
  try { body = await res.json(); } catch { /* corps non JSON */ }
  if (!res.ok) throw new Error(`Prix de marché : ${body?.message ?? `erreur ${res.status}`}`);
  const prices = parsePriceResponse(body);
  if (!prices.size) throw new Error('Prix de marché : aucune donnée ENTSO-E sur cette période.');
  return prices;
}

// ---------- Maquette A : chronologie, prix capté par période, comparaison avec son offre ----------

const dayOf = (pt) => isoDay(new Date(pt.t.getTime() - 60_000)); // jour du début d'intervalle

/** Fenêtres de 7 jours (la plus récente d'abord), pour la chronologie sur une longue période. */
export function weekWindows(points) {
  const days = [...new Set(points.map(dayOf))].sort();
  const out = [];
  for (let end = days.length; end > 0; end -= 7) {
    const from = days[Math.max(0, end - 7)]; const last = days[end - 1];
    out.push({ from, last, label: `Du ${from.slice(8, 10)}/${from.slice(5, 7)} au ${last.slice(8, 10)}/${last.slice(5, 7)}` });
  }
  return out;
}

/** Mesures d'une fenêtre [from, last] (jours inclus). */
export const pointsIn = (points, { from, last }) => points.filter((p) => { const d = dayOf(p); return d >= from && d <= last; });

/** Unité de regroupement du prix capté selon la longueur de la période. */
export const capturedUnit = (nDays) => (nDays <= 31 ? 'day' : nDays <= 120 ? 'week' : 'month');

function groupKey(day, unit) {
  if (unit === 'month') return day.slice(0, 7);
  if (unit === 'week') {
    const d = new Date(`${day}T00:00:00Z`);
    return isoDay(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000)); // lundi
  }
  return day;
}

/** Prix capté et prix moyen du marché par jour, semaine (clé = lundi) ou mois. */
export function capturedBy(points, unit = 'day') {
  const step = stepMinutes(points);
  const acc = new Map();
  for (const pt of points) {
    if (pt.p == null) continue;
    const key = groupKey(dayOf(pt), unit);
    const a = acc.get(key) ?? { mwh: 0, cost: 0, psum: 0, n: 0 };
    const e = (pt.v * (step / 60)) / 1e6;
    a.mwh += e; a.cost += e * pt.p; a.psum += pt.p; a.n += 1;
    acc.set(key, a);
  }
  return [...acc].sort(([a], [b]) => (a < b ? -1 : 1)).filter(([, a]) => a.mwh > 0)
    .map(([key, a]) => ({ key, unit, captured: a.cost / a.mwh, market: a.psum / a.n, energyKWh: a.mwh * 1000, cost: a.cost }));
}

/** "0,1952" ou "0.1952" -> 0.1952 ; null si vide ou invalide. */
export function parseEuro(text) {
  const v = Number(String(text ?? '').trim().replace(',', '.'));
  return text && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Compare la valorisation au prix de gros avec le coût au prix du kWh de son offre.
 * L'écart couvre l'acheminement (TURPE), les taxes, la marge et les coûts du fournisseur.
 */
export function compareOffer(summary, priceEurKWh) {
  if (!summary || !priceEurKWh) return null;
  const offerCost = summary.energyKWh * priceEurKWh;
  return { offerCost, spotCost: summary.cost, gap: offerCost - summary.cost, spotShare: summary.cost / offerCost };
}
