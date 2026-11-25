// Prix de gros day-ahead France (ENTSO-E via le relais) et valorisation de la consommation.
//
// Deux prix moyens, calculés de la même façon (moyenne des prix pondérée par un volume consommé) :
// - « ton prix capté » : pondéré par TA consommation (courbe de charge Linky) ;
// - « prix capté par la consommation française » (prix moyen du marché) : pondéré par la
//   consommation nationale réalisée (ENTSO-E, Actual Total Load), sur les mêmes intervalles.
// Si la consommation nationale manque, repli sur la moyenne simple des prix (chaque intervalle pèse autant).
//
// Conventions (cf. data.js) : heures murales stockées en UTC dans des Date.
// - Prix : horodatage = DÉBUT du quart d'heure.
// - Courbe Linky : horodatage = FIN de l'intervalle (t - pas → t).
// Le prix d'une mesure est la moyenne des quarts d'heure qui la composent.

import { isoDay, parseTimestamp, stepMinutes } from './data.js';

const Q = 15 * 60_000;

/**
 * Réponse du relais -> { prices, loads } : Map(ms du début du quart d'heure -> €/MWh, resp. MW de
 * consommation France). Doublons (heure d'hiver) moyennés.
 */
export function parsePriceResponse(json) {
  const accP = new Map(); const accL = new Map();
  const add = (acc, k, v) => { const a = acc.get(k); if (a) { a.sum += v; a.n += 1; } else acc.set(k, { sum: v, n: 1 }); };
  for (const [ts, p, l] of json?.points ?? []) {
    const t = parseTimestamp(ts);
    if (!t || !Number.isFinite(p)) continue;
    add(accP, t.getTime(), p);
    if (Number.isFinite(l) && l > 0) add(accL, t.getTime(), l);
  }
  const avg = (acc) => new Map([...acc].map(([k, a]) => [k, a.sum / a.n]));
  return { prices: avg(accP), loads: avg(accL) };
}

/**
 * Ajoute à chaque mesure son prix moyen `p` (€/MWh) et la consommation France moyenne `l` (MW)
 * sur l'intervalle, ou null si un quart d'heure manque. Avec la conso France, `p` est la moyenne
 * des quarts d'heure pondérée par cette conso (cohérent avec la pondération du prix de marché).
 */
export function attachPrices(points, prices, loads = new Map()) {
  const step = stepMinutes(points);
  const quarters = Math.max(1, Math.round(step / 15));
  return points.map((pt) => {
    const start = pt.t.getTime() - step * 60_000;
    let sum = 0; let lsum = 0; let plsum = 0; let hasLoad = true;
    for (let i = 0; i < quarters; i++) {
      const v = prices.get(start + i * Q);
      if (v === undefined) return { ...pt, p: null, l: null };
      const l = loads.get(start + i * Q);
      if (l === undefined) hasLoad = false; else { lsum += l; plsum += v * l; }
      sum += v;
    }
    return { ...pt, p: sum / quarters, l: hasLoad ? lsum / quarters : null, pl: hasLoad ? plsum / lsum : null };
  });
}

/** Accumulateur commun : ton prix capté et le prix capté par la consommation France, sur les mêmes intervalles. */
function newAcc() { return { mwh: 0, cost: 0, psum: 0, n: 0, lsum: 0, plsum: 0, nl: 0 }; }
function accumulate(a, pt, step) {
  const e = (pt.v * (step / 60)) / 1e6;
  a.mwh += e; a.cost += e * pt.p; a.psum += pt.p; a.n += 1;
  if (pt.l != null) { a.lsum += pt.l; a.plsum += pt.pl * pt.l; a.nl += 1; }
}
function finish(a) {
  const weighted = a.nl > 0 && a.nl === a.n; // conso France connue sur tous les intervalles
  return {
    energyKWh: a.mwh * 1000,
    cost: a.cost,
    captured: a.cost / a.mwh,
    market: weighted ? a.plsum / a.lsum : a.psum / a.n,
    marketKind: weighted ? 'france' : 'simple',
  };
}

/** Coût en € d'une mesure (puissance moyenne v en W sur `step` minutes, prix p en €/MWh). */
export const costOf = (v, p, step) => (v * (step / 60) / 1e6) * p;

/**
 * Indicateurs « marché » sur les mesures valorisées.
 * - ton prix capté = Σ (ton énergie × prix) / Σ ton énergie
 * - prix capté par la conso France (prix moyen du marché) = Σ (conso France × prix) / Σ conso France,
 *   sur les mêmes intervalles ; moyenne simple des prix si la conso France manque (marketKind 'simple')
 * - facteur de forme = ton prix capté / prix capté par la conso France
 *   (> 1 : ton profil de conso coûte plus cher que le profil moyen français)
 */
export function summarizeMarket(points) {
  const step = stepMinutes(points);
  const a = newAcc();
  for (const pt of points) if (pt.p != null) accumulate(a, pt, step);
  if (!a.n || a.mwh <= 0) return null;
  const r = finish(a);
  return { ...r, shape: r.captured / r.market, coverage: a.n / points.length };
}

/** Bornes de la requête de prix [debut, fin[ couvrant toutes les mesures. */
export function priceRange(points) {
  const first = new Date(points[0].t.getTime() - 60_000);
  const last = new Date(points[points.length - 1].t.getTime() - 60_000);
  return { debut: isoDay(first), fin: isoDay(new Date(last.getTime() + 86_400_000)) };
}

/** Prix fictifs (pour les données d'exemple) : profil journalier + saison + quelques pics et prix négatifs. */
export function demoLoads(prices) {
  // Conso France fictive : 45 à 80 GW, plus forte l'hiver, pointes le matin et le soir
  const loads = new Map();
  for (const t of prices.keys()) {
    const d = new Date(t);
    const h = d.getUTCHours() + d.getUTCMinutes() / 60;
    const doy = (t - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000;
    const winter = Math.max(0, Math.cos((2 * Math.PI * (doy - 15)) / 365));
    const shape = 0.82 + 0.12 * Math.exp(-(((h - 9) / 2.5) ** 2)) + 0.18 * Math.exp(-(((h - 19.5) / 2) ** 2)) - (h < 6 ? 0.08 : 0);
    loads.set(t, Math.round((48000 + 30000 * winter) * shape));
  }
  return loads;
}

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

/** Récupère les prix (et la conso France) auprès du relais OptiWatt : { prices, loads }. */
export async function fetchDayAhead({ baseUrl, debut, fin }) {
  if (!baseUrl) throw new Error("Prix de marché indisponibles : aucune URL de relais n'est configurée (paramètres avancés de l'onglet API).");
  const url = `${baseUrl.replace(/\/+$/, '')}/api/prix_day_ahead?${new URLSearchParams({ debut, fin })}`;
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json' } }); }
  catch { throw new Error('Prix de marché : le relais est injoignable.'); }
  let body = null;
  try { body = await res.json(); } catch { /* corps non JSON */ }
  if (!res.ok) throw new Error(`Prix de marché : ${body?.message ?? `erreur ${res.status}`}`);
  const market = parsePriceResponse(body);
  if (!market.prices.size) throw new Error('Prix de marché : aucune donnée ENTSO-E sur cette période.');
  return market;
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

/** Ton prix capté et prix capté par la conso France, par jour, semaine (clé = lundi) ou mois. */
export function capturedBy(points, unit = 'day') {
  const step = stepMinutes(points);
  const acc = new Map();
  for (const pt of points) {
    if (pt.p == null) continue;
    const key = groupKey(dayOf(pt), unit);
    const a = acc.get(key) ?? newAcc();
    accumulate(a, pt, step);
    acc.set(key, a);
  }
  return [...acc].sort(([a], [b]) => (a < b ? -1 : 1)).filter(([, a]) => a.mwh > 0)
    .map(([key, a]) => ({ key, unit, ...finish(a) }));
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
