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
