// Traitement des données de consommation (fonctions pures, testées dans data.test.js)
//
// Convention : les horodatages Enedis marquent la FIN de l'intervalle de mesure
// ("00:30" = mesure de 00:00 à 00:30). On retire 1 minute avant de calculer
// l'heure, ce qui fonctionne quel que soit le pas (10, 15, 30 ou 60 min).
// Les dates sont manipulées en "heure murale" (heure locale française écrite
// dans la donnée), stockées dans des objets Date en UTC pour éviter tout
// décalage lié au fuseau du navigateur.

const TS_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
const TS_FR_RE = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

/** Convertit "2026-04-01 00:30:00", "2026-04-01T00:30:00+02:00" ou "01/04/2026 00:30" en Date (heure murale, UTC). */
export function parseTimestamp(raw) {
  const s = String(raw ?? '').trim().replace(/^"|"$/g, '');
  let m = s.match(TS_RE);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
  m = s.match(TS_FR_RE);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] ?? 0)));
  return null;
}

/** "1 234,5" / "1234.5" / "" -> nombre ou NaN */
export function parseNumber(raw) {
  const s = String(raw ?? '').trim().replace(/^"|"$/g, '').replace(/\s/g, '').replace(',', '.');
  return s === '' ? NaN : Number(s);
}

/**
 * Lit un export CSV Enedis (espace client) : quelques lignes d'en-tête puis
 * une ligne "Horodate;Valeur" suivie des mesures. Séparateur ; ou ,.
 * Retourne [{ t: Date, v: number }] trié.
 */
export function parseEnedisCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const sep = (lines.find((l) => l.includes(';')) ? ';' : ',');
  let start = lines.findIndex((l) => /^"?horodate"?$/i.test(l.split(sep)[0].trim()));
  start = start === -1 ? 0 : start + 1;
  const points = [];
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split(sep);
    if (cells.length < 2) continue;
    const t = parseTimestamp(cells[0]);
    const v = parseNumber(cells[1]);
    if (t && Number.isFinite(v)) points.push({ t, v });
  }
  if (!points.length) {
    throw new Error("Aucune mesure reconnue. Le fichier doit contenir une colonne « Horodate » et une colonne « Valeur ».");
  }
  return points.sort((a, b) => a.t - b.t);
}

/**
 * Lit la réponse de l'API conso.boris.sh (format 2026 : grandeur[0].points[{d, v}]).
 * Accepte aussi l'ancien format (interval_reading[{date, value}]) par robustesse.
 */
export function parseApiResponse(json) {
  const g = json?.grandeur?.[0] ?? json?.contexte?.[0]?.grandeur?.[0];
  const raw = g?.points
    ? g.points.map((p) => ({ d: p.d, v: p.v }))
    : (json?.interval_reading ?? json?.meter_reading?.interval_reading ?? []).map((p) => ({ d: p.date, v: p.value }));
  const points = raw
    .map((p) => ({ t: parseTimestamp(p.d), v: parseNumber(p.v) }))
    .filter((p) => p.t && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  return { unit: g?.unite ?? 'W', points };
}

const pad = (n) => String(n).padStart(2, '0');
export const isoDay = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * Agrège les mesures par jour et par créneau de `step` minutes (30 = pas le plus fin
 * d'une courbe de charge Linky, 60 = une case par heure).
 * @param {{t: Date, v: number}[]} points
 * @param {{agg?: 'mean'|'max', cap?: number, step?: 30|60}} opts cap = plafond en W (puissance souscrite), 0/undefined = aucun
 * @returns {{date: string, month: string, day: number, slot: number, hour: number, minute: number, step: number,
 *            value: number, raw: number, capped: boolean}[]}
 *   slot = index du créneau dans la journée (0 à 1440/step - 1)
 */
export function aggregate(points, { agg = 'mean', cap, step = 60 } = {}) {
  const groups = new Map();
  for (const { t, v } of points) {
    const s = new Date(t.getTime() - 60_000); // début d'intervalle
    const slot = Math.floor((s.getUTCHours() * 60 + s.getUTCMinutes()) / step);
    const key = `${isoDay(s)}|${slot}`;
    const g = groups.get(key);
    if (g) { g.sum += v; g.n += 1; g.max = Math.max(g.max, v); }
    else groups.set(key, { sum: v, n: 1, max: v });
  }
  const rows = [];
  for (const [key, g] of groups) {
    const [date, sl] = key.split('|');
    const slot = +sl;
    const raw = agg === 'max' ? g.max : g.sum / g.n;
    const capped = cap > 0 && raw > cap;
    rows.push({
      date,
      month: date.slice(0, 7),
      day: +date.slice(8, 10),
      slot,
      hour: Math.floor((slot * step) / 60),
      minute: (slot * step) % 60,
      step,
      raw,
      value: capped ? cap : raw,
      capped,
    });
  }
  return rows.sort((a, b) => (a.date === b.date ? a.slot - b.slot : a.date < b.date ? -1 : 1));
}

/** Agrégation par heure (compatibilité). */
export const aggregateHourly = (points, opts = {}) => aggregate(points, { ...opts, step: 60 });

/** Pas de mesure médian, en minutes (30 pour une courbe de charge Linky). */
export function stepMinutes(points) {
  if (points.length < 2) return 30;
  const diffs = [];
  for (let i = 1; i < points.length; i++) diffs.push((points[i].t - points[i - 1].t) / 60_000);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 30;
}

/** Indicateurs clés sur les mesures brutes (puissances moyennes en W). */
export function summarize(points) {
  if (!points.length) return null;
  const step = stepMinutes(points);
  let energyWh = 0;
  let peak = points[0];
  for (const p of points) {
    energyWh += p.v * (step / 60);
    if (p.v > peak.v) peak = p;
  }
  const first = new Date(points[0].t.getTime() - 60_000);
  const last = new Date(points[points.length - 1].t.getTime() - 60_000);
  const days = Math.round((Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()) -
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate())) / 86_400_000) + 1;
  return {
    from: isoDay(first),
    to: isoDay(last),
    days,
    energyKWh: energyWh / 1000,
    avgKWhPerDay: energyWh / 1000 / days,
    peakW: peak.v,
    peakAt: peak.t,
    step,
  };
}

/** Export CSV réimportable (même format que l'espace client Enedis). */
export function toCsv(points) {
  const fmt = (d) => `${isoDay(d)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
  return ['Horodate;Valeur', ...points.map((p) => `${fmt(p.t)};${p.v}`)].join('\n') + '\n';
}

/** Bornes de requête API : [dateFin - n jours, dateFin[ (dateFin exclusive). */
export function apiRange(endDate, days) {
  const end = parseTimestamp(`${endDate} 00:00`);
  const start = new Date(end.getTime() - days * 86_400_000);
  return { dateDebut: isoDay(start), dateFin: isoDay(end) };
}
