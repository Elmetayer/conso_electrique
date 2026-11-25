// Heatmaps de consommation avec Observable Plot (https://observablehq.com/plot/)
import * as Plot from '@observablehq/plot';

const DAYS31 = Array.from({ length: 31 }, (_, i) => i + 1);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

const fmtW = (v) => `${Math.round(v).toLocaleString('fr-FR')} W`;
const fmtDay = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};
const fmtMonth = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

// Échelles de couleur selon la grandeur affichée
// - puissance : séquentielle à une teinte (clair = faible, foncé = forte puissance)
// - prix et coût : divergente centrée sur 0 (bleu = négatif, rouge = positif), les prix pouvant être négatifs
// Sans plafond : bornes = 1er et 99e centiles, pour qu'un pic isolé n'écrase pas les contrastes
const fmtNum = (v, d) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
const quantile = (sorted, q) => sorted[Math.floor((sorted.length - 1) * q)];
export const METRICS = {
  power: { label: 'Puissance (W)', fmt: (v) => fmtW(v), tick: (v) => v.toLocaleString('fr-FR') },
  price: { label: 'Prix day-ahead (€/MWh)', fmt: (v) => `${fmtNum(v, 1)} €/MWh`, tick: (v) => v.toLocaleString('fr-FR') },
  cost: { label: 'Coût au prix de gros (c€)', fmt: (v) => `${fmtNum(v * 100, 2)} c€`, tick: (v) => fmtNum(v * 100, 1) },
};

function colorScale(rows, cap, metric = 'power') {
  const sorted = rows.map((r) => r.value).sort((a, b) => a - b);
  const m = METRICS[metric];
  const common = { legend: true, marginLeft: 12, width: 280, label: m.label, tickFormat: m.tick, clamp: true };
  if (metric === 'power') {
    const max = cap > 0 ? cap : quantile(sorted, 0.99) || 1;
    return { ...common, type: 'linear', scheme: 'reds', domain: [0, max] };
  }
  const lo = Math.min(0, quantile(sorted, 0.01) ?? 0);
  const hi = Math.max(quantile(sorted, 0.99) ?? 1, 1e-6);
  return { ...common, type: 'diverging', scheme: 'rdbu', reverse: true, pivot: 0, symmetric: false, domain: [lo, hi] };
}

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
/** Créneaux de la journée pour un pas donné : [0, 1, …, 1440/step - 1] */
const slotsFor = (step) => Array.from({ length: 1440 / step }, (_, i) => i);
/** Étiquette d'axe : affichée toutes les `every` heures seulement */
const slotLabel = (step, every) => (slot) => ((slot * step) % (every * 60) === 0 ? `${(slot * step) / 60}h` : '');
const stepOf = (rows) => rows[0]?.step ?? 60;

const tip = {
  format: { x: false, y: false, fx: false, fy: false, fill: false },
};
const tipChannels = (metric = 'power') => ({
  Jour: (d) => fmtDay(d.date),
  Heure: (d) => `${hhmm(d.slot * d.step)} – ${hhmm((d.slot + 1) * d.step)}`,
  [metric === 'power' ? 'Puissance' : metric === 'price' ? 'Prix' : 'Coût']:
    (d) => METRICS[metric].fmt(d.raw) + (d.capped ? ' (plafonnée)' : ''),
});
const metricOf = (rows) => rows[0]?.metric ?? 'power';

/** Heatmap « long » : une ligne par jour (plus récent en haut), une colonne par créneau (1 h ou 30 min). */
export function longHeatmap(rows, { cap, width = 720 } = {}) {
  const step = stepOf(rows);
  const slots = slotsFor(step);
  const days = [...new Set(rows.map((r) => r.date))].sort().reverse();
  const w = Math.min(width, 760);
  const marginLeft = 104;
  const cell = Math.max(slots.length > 24 ? 6 : 10, Math.min(28, (w - marginLeft - 10) / slots.length));
  const rowH = days.length <= 14 ? cell : days.length <= 62 ? Math.min(cell, 16) : 9;
  const ticks = days.length > 62 ? days.filter((d) => d.endsWith('-01') || d.endsWith('-15')) : days;
  return Plot.plot({
    width: Math.max(w, marginLeft + 10 + cell * slots.length),
    height: 40 + days.length * rowH,
    marginLeft,
    marginTop: 28,
    x: { type: 'band', domain: slots, axis: 'top', label: null, tickFormat: slotLabel(step, 3), tickSize: 0 },
    y: { type: 'band', domain: days, label: null, ticks, tickFormat: fmtDay, tickSize: 0 },
    color: colorScale(rows, cap, metricOf(rows)),
    marks: [Plot.cell(rows, { x: 'slot', y: 'date', fill: 'value', inset: rowH > 12 && cell > 12 ? 1 : 0.5, rx: rowH > 12 && cell > 12 ? 2 : 1, channels: tipChannels(metricOf(rows)), tip })],
  });
}

/** Heatmap « par mois » : petits multiples, un mois = jours (x) × créneaux (y, 0 h en haut). */
export function monthHeatmap(rows, { cap, width = 960 } = {}) {
  const step = stepOf(rows);
  const slots = slotsFor(step);
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const cols = width < 560 ? 1 : width < 900 ? 2 : 3;
  const index = new Map(months.map((m, i) => [m, i]));
  const fx = (d) => index.get(d.month) % cols;
  const fy = (d) => Math.floor(index.get(d.month) / cols);
  const nRows = Math.ceil(months.length / cols);
  const marginLeft = 34;
  const facetW = (width - marginLeft - 10) / cols;
  // au pas de 30 min, cases deux fois plus nombreuses mais moins hautes (facette 1,5 fois plus haute)
  const facetH = ((facetW * 0.9 * 24) / 31) * (slots.length > 24 ? 1.5 : 1);
  const labels = months.map((m) => ({ month: m }));

  return Plot.plot({
    width,
    height: nRows * facetH * 1.3 + 40,
    marginLeft,
    marginTop: 24,
    fx: { axis: null, padding: 0.1 },
    fy: { axis: null, padding: 0.28 },
    x: { type: 'band', domain: DAYS31, label: null, tickFormat: (d) => ([1, 10, 20, 31].includes(d) ? d : ''), tickSize: 0 },
    y: { type: 'band', domain: slots, label: null, tickFormat: slotLabel(step, 6), tickSize: 0 },
    color: colorScale(rows, cap, metricOf(rows)),
    marks: [
      Plot.cell(rows, { x: 'day', y: 'slot', fx, fy, fill: 'value', inset: slots.length > 24 ? 0.3 : 0.5, channels: tipChannels(metricOf(rows)), tip }),
      Plot.text(labels, { fx, fy, text: (d) => fmtMonth(d.month), frameAnchor: 'top-left', dy: -8, lineAnchor: 'bottom', fontWeight: 600, fontSize: 12 }),
    ],
  });
}

const slotTip = (d) => `${hhmm(d.slot * d.step)} – ${hhmm((d.slot + 1) * d.step)}`;
function slotMeans(rows, slots, step) {
  const acc = new Map();
  for (const r of rows) {
    const a = acc.get(r.slot) ?? { s: 0, n: 0 };
    a.s += r.raw; a.n += 1;
    acc.set(r.slot, a);
  }
  return slots.filter((s) => acc.has(s)).map((s) => ({ slot: s, step, v: acc.get(s).s / acc.get(s).n }));
}

/**
 * Profil journalier moyen : puissance moyenne (barres) au-dessus du prix day-ahead moyen (courbe),
 * sur le même axe horaire. `power` et `price` = lignes d'aggregate() au même pas.
 */
export function profileChart(power, price, { width = 720 } = {}) {
  const step = stepOf(power);
  const slots = slotsFor(step);
  const w = Math.min(width, 960);
  const x = { type: 'band', domain: slots, label: null, tickFormat: slotLabel(step, 3), tickSize: 0, paddingInner: 0.15 };
  const kw = slotMeans(power, slots, step).map((d) => ({ ...d, v: d.v / 1000 }));
  const eur = slotMeans(price, slots, step);
  const top = Plot.plot({
    width: w, height: 150, marginLeft: 56, marginBottom: 6,
    x: { ...x, axis: null },
    y: { label: 'kW moyen', grid: true, tickFormat: (v) => fmtNum(v, 1) },
    marks: [
      Plot.barY(kw, { x: 'slot', y: 'v', fill: 'var(--accent)', fillOpacity: 0.55, channels: { Heure: slotTip, Puissance: (d) => `${fmtNum(d.v, 2)} kW` }, tip: { format: { x: false, y: false } } }),
      Plot.ruleY([0]),
    ],
  });
  const bottom = Plot.plot({
    width: w, height: 160, marginLeft: 56,
    x,
    y: { label: '€/MWh moyen', grid: true },
    marks: [
      Plot.ruleY([0], { strokeOpacity: 0.4 }),
      Plot.lineY(eur, { x: 'slot', y: 'v', strokeWidth: 1.8, curve: 'step' }),
      Plot.tip(eur, Plot.pointerX({ x: 'slot', y: 'v', channels: { Heure: slotTip, Prix: (d) => `${fmtNum(d.v, 1)} €/MWh` }, format: { x: false, y: false } })),
    ],
  });
  const div = document.createElement('div');
  div.className = 'profile';
  div.append(top, bottom);
  return div;
}

/** Coût au prix de gros par jour (barres ; bleu si négatif). `cost` = lignes d'aggregate() avec metric 'cost'. */
export function dailyCostChart(cost, { width = 720 } = {}) {
  const byDay = new Map();
  for (const r of cost) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.raw);
  const data = [...byDay].sort().map(([date, eur]) => ({ date, d: new Date(`${date}T00:00:00Z`), eur }));
  return Plot.plot({
    width: Math.min(width, 960), height: 200, marginLeft: 56,
    x: { type: 'utc', label: null },
    y: { label: '€ / jour', grid: true, tickFormat: (v) => fmtNum(v, 2) },
    marks: [
      Plot.rectY(data, {
        x: 'd', y: 'eur', interval: 'day', inset: data.length > 120 ? 0 : 1,
        fill: (d) => (d.eur < 0 ? '#2563eb' : 'var(--accent)'),
        channels: { Jour: (d) => fmtDay(d.date), Coût: (d) => `${fmtNum(d.eur, 2)} €` },
        tip: { format: { x: false, y: false, fill: false } },
      }),
      Plot.ruleY([0]),
    ],
  });
}


const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WD = WEEKDAYS;
const fmtWall = (d) => `${WD[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${hhmm(d.getUTCHours() * 60 + d.getUTCMinutes())}`;

/**
 * Chronologie : puissance moyenne (aire) au-dessus du prix day-ahead (courbe ; prix négatifs en bleu),
 * sur le même axe de temps. `points` = mesures valorisées (t = fin d'intervalle, v en W, p en €/MWh).
 */
export function timelineChart(points, { width = 720 } = {}) {
  const step = stepMinutesOf(points);
  const data = points.map((pt) => ({ t: new Date(pt.t.getTime() - step * 30_000), kw: pt.v / 1000, p: pt.p, end: pt.t }));
  const w = Math.min(width, 960);
  const x = { type: 'utc', label: null, ticks: 'day', tickFormat: (d) => `${WD[d.getUTCDay()]} ${d.getUTCDate()}`, grid: true };
  const tipFmt = { x: false, y: false };
  const tipCh = { Créneau: (d) => `${fmtWall(new Date(d.end.getTime() - step * 60_000))} – ${hhmm(d.end.getUTCHours() * 60 + d.end.getUTCMinutes())}`,
    Puissance: (d) => `${fmtNum(d.kw, 2)} kW`, Prix: (d) => (d.p == null ? 'non disponible' : `${fmtNum(d.p, 1)} €/MWh`) };
  const top = Plot.plot({
    width: w, height: 170, marginLeft: 56, marginBottom: 6,
    x: { ...x, axis: null },
    y: { label: 'kW', grid: true, tickFormat: (v) => fmtNum(v, 1) },
    marks: [
      Plot.areaY(data, { x: 't', y: 'kw', fill: 'var(--accent)', fillOpacity: 0.2, curve: 'step' }),
      Plot.lineY(data, { x: 't', y: 'kw', stroke: 'var(--accent)', strokeWidth: 1.2, curve: 'step' }),
      Plot.ruleY([0]),
      Plot.tip(data, Plot.pointerX({ x: 't', y: 'kw', channels: tipCh, format: tipFmt })),
    ],
  });
  const priced = data.filter((d) => d.p != null);
  const bottom = Plot.plot({
    width: w, height: 170, marginLeft: 56,
    x,
    y: { label: '€/MWh', grid: true },
    marks: [
      Plot.areaY(priced, { x: 't', y1: 0, y2: (d) => Math.min(0, d.p), fill: '#2563eb', fillOpacity: 0.6, curve: 'step' }),
      Plot.ruleY([0], { strokeOpacity: 0.5 }),
      Plot.lineY(data, { x: 't', y: 'p', strokeWidth: 1.2, curve: 'step', defined: (d) => d.p != null }),
      Plot.tip(priced, Plot.pointerX({ x: 't', y: 'p', channels: tipCh, format: tipFmt })),
    ],
  });
  const div = document.createElement('div');
  div.className = 'profile';
  div.append(top, bottom);
  return div;
}
const stepMinutesOf = (points) => (points.length > 1 ? Math.round((points[1].t - points[0].t) / 60_000) || 30 : 30);

/** Libellé d'une ligne de capturedBy(). */
export function periodLabel({ key, unit }) {
  const d = new Date(`${unit === 'month' ? `${key}-01` : key}T00:00:00Z`);
  if (unit === 'month') return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const dm = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return unit === 'week' ? `sem. du ${dm}` : `${WD[d.getUTCDay()]} ${dm}`;
}

/**
 * Prix capté (point plein : orange si au-dessus du marché, bleu sinon) et prix moyen du marché
 * (point creux), une ligne par jour, semaine ou mois. `rows` = capturedBy().
 */
export function capturedChart(rows, { width = 720 } = {}) {
  const data = rows.map((r) => ({ ...r, label: periodLabel(r), dear: r.captured > r.market }));
  const color = (d) => (d.dear ? 'var(--accent)' : '#2563eb');
  const ch = { Période: 'label', 'Prix capté': (d) => `${fmtNum(d.captured, 1)} €/MWh`, 'Prix moyen du marché': (d) => `${fmtNum(d.market, 1)} €/MWh`,
    Énergie: (d) => `${fmtNum(d.energyKWh, 1)} kWh`, Coût: (d) => `${fmtNum(d.cost, 2)} €` };
  return Plot.plot({
    width: Math.min(width, 640), height: 40 + data.length * 22, marginLeft: 92,
    x: { label: '€/MWh', grid: true },
    y: { domain: data.map((d) => d.label), label: null, tickSize: 0 },
    marks: [
      Plot.link(data, { x1: 'market', x2: 'captured', y1: 'label', y2: 'label', stroke: color, strokeWidth: 3, strokeOpacity: 0.45 }),
      Plot.dot(data, { x: 'market', y: 'label', r: 4.5, fill: 'var(--surface, #fff)', stroke: 'currentColor', strokeWidth: 1.5 }),
      Plot.dot(data, { x: 'captured', y: 'label', r: 4.5, fill: color, channels: ch, tip: { format: { x: false, y: false, fill: false } } }),
    ],
  });
}

/** Message affiché à la place d'un graphique. */
export function placeholder(message) {
  const div = document.createElement('div');
  div.className = 'placeholder';
  div.textContent = message;
  return div;
}

// ---------- Exports ----------

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function serialize(svg) {
  const clone = svg.cloneNode(true);
  const cs = getComputedStyle(svg);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.style.fontFamily = cs.fontFamily;
  clone.style.color = cs.color;
  return new XMLSerializer().serializeToString(clone);
}

/** Exporte le graphique principal en SVG. */
export function exportSvg(chart, filename) {
  const svgs = chart.tagName === 'svg' ? [chart] : [...chart.querySelectorAll('svg')];
  const main = svgs[svgs.length - 1];
  download(new Blob([serialize(main)], { type: 'image/svg+xml' }), filename);
}

/** Exporte le graphique (légende comprise) en PNG haute résolution. */
export async function exportPng(chart, filename, scale = 2) {
  const svgs = chart.tagName === 'svg' ? [chart] : [...chart.querySelectorAll('svg')];
  const sizes = svgs.map((s) => s.getBoundingClientRect());
  const width = Math.max(...sizes.map((s) => s.width));
  const height = sizes.reduce((h, s) => h + s.height + 8, 16);
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff';
  ctx.fillRect(0, 0, width, height);
  let y = 8;
  for (let i = 0; i < svgs.length; i++) {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serialize(svgs[i]));
    await img.decode();
    ctx.drawImage(img, 0, y, sizes[i].width, sizes[i].height);
    y += sizes[i].height + 8;
  }
  canvas.toBlob((blob) => download(blob, filename), 'image/png');
}

export function exportCsv(text, filename) {
  download(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename);
}
