// Heatmaps de consommation avec Observable Plot (https://observablehq.com/plot/)
import * as Plot from '@observablehq/plot';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS31 = Array.from({ length: 31 }, (_, i) => i + 1);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

const fmtW = (v) => `${Math.round(v).toLocaleString('fr-FR')} W`;
const fmtDay = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};
const fmtMonth = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

// Échelle séquentielle à une seule teinte (clair = faible, foncé = forte puissance)
// Sans plafond : borne haute = 99e centile, pour qu'un pic isolé n'écrase pas les contrastes
function colorScale(rows, cap) {
  const sorted = rows.map((r) => r.value).sort((a, b) => a - b);
  const max = cap > 0 ? cap : sorted[Math.floor((sorted.length - 1) * 0.99)] || 1;
  return { type: 'linear', scheme: 'reds', domain: [0, max], clamp: true, legend: true, marginLeft: 12, width: 280, label: 'Puissance (W)', tickFormat: (v) => v.toLocaleString('fr-FR') };
}

const tip = {
  format: { x: false, y: false, fx: false, fy: false, fill: false },
};
const tipChannels = {
  Jour: (d) => fmtDay(d.date),
  Heure: (d) => `${d.hour} h – ${d.hour + 1} h`,
  Puissance: (d) => fmtW(d.raw) + (d.capped ? ' (plafonnée)' : ''),
};

/** Heatmap « long » : une ligne par jour (plus récent en haut), une colonne par heure. */
export function longHeatmap(rows, { cap, width = 720 } = {}) {
  const days = [...new Set(rows.map((r) => r.date))].sort().reverse();
  const w = Math.min(width, 760);
  const marginLeft = 104;
  const cell = Math.max(10, Math.min(28, (w - marginLeft - 10) / 24));
  const rowH = days.length <= 14 ? cell : days.length <= 62 ? Math.min(cell, 16) : 9;
  const ticks = days.length > 62 ? days.filter((d) => d.endsWith('-01') || d.endsWith('-15')) : days;
  return Plot.plot({
    width: w,
    height: 40 + days.length * rowH,
    marginLeft,
    marginTop: 28,
    x: { type: 'band', domain: HOURS, axis: 'top', label: null, tickFormat: (h) => (h % 3 === 0 ? `${h}h` : ''), tickSize: 0 },
    y: { type: 'band', domain: days, label: null, ticks, tickFormat: fmtDay, tickSize: 0 },
    color: colorScale(rows, cap),
    marks: [Plot.cell(rows, { x: 'hour', y: 'date', fill: 'value', inset: rowH > 12 ? 1 : 0.5, rx: rowH > 12 ? 2 : 1, channels: tipChannels, tip })],
  });
}

/** Heatmap « par mois » : petits multiples, un mois = jours (x) × heures (y, 0 h en haut). */
export function monthHeatmap(rows, { cap, width = 960 } = {}) {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const cols = width < 560 ? 1 : width < 900 ? 2 : 3;
  const index = new Map(months.map((m, i) => [m, i]));
  const fx = (d) => index.get(d.month) % cols;
  const fy = (d) => Math.floor(index.get(d.month) / cols);
  const nRows = Math.ceil(months.length / cols);
  const marginLeft = 34;
  const facetW = (width - marginLeft - 10) / cols;
  const facetH = (facetW * 0.9 * 24) / 31;
  const labels = months.map((m) => ({ month: m }));

  return Plot.plot({
    width,
    height: nRows * facetH * 1.3 + 40,
    marginLeft,
    marginTop: 24,
    fx: { axis: null, padding: 0.1 },
    fy: { axis: null, padding: 0.28 },
    x: { type: 'band', domain: DAYS31, label: null, tickFormat: (d) => ([1, 10, 20, 31].includes(d) ? d : ''), tickSize: 0 },
    y: { type: 'band', domain: HOURS, label: null, tickFormat: (h) => (h % 6 === 0 ? `${h}h` : ''), tickSize: 0 },
    color: colorScale(rows, cap),
    marks: [
      Plot.cell(rows, { x: 'day', y: 'hour', fx, fy, fill: 'value', inset: 0.5, channels: tipChannels, tip }),
      Plot.text(labels, { fx, fy, text: (d) => fmtMonth(d.month), frameAnchor: 'top-left', dy: -8, lineAnchor: 'bottom', fontWeight: 600, fontSize: 12 }),
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
