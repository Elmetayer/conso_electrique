import './style.css';
import { aggregate, apiRange, parseEnedisCsv, stepMinutes, summarize, toCsv } from './data.js';
import { fetchLoadCurve } from './api.js';
import { dailyCostChart, exportCsv, exportPng, exportSvg, longHeatmap, monthHeatmap, placeholder, profileChart } from './charts.js';
import { demoPoints } from './demo.js';
import { attachPrices, demoPrices, fetchDayAhead, priceRange, summarizeMarket } from './prices.js';

const CAP_OPTIONS = [3, 6, 9, 12, 15, 18, 24, 30, 36];
const STORE_KEY = 'optiwatt.settings';
const ENV_PROXY = import.meta.env.VITE_PROXY_URL ?? '';
/** URL du relais (paramètres avancés de l'onglet API, sinon celle de la configuration du site). */
const relayUrl = () => document.getElementById('api-form')?.proxy.value.trim() || ENV_PROXY;

// ---------- Stockage local (protégé : peut être indisponible) ----------
const store = {
  get(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};
const cache = {
  get(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ } },
};

// ---------- Onglets ----------
const tabs = [...document.querySelectorAll('[role=tab]')];
function selectTab(id) {
  for (const t of tabs) {
    const on = t.id === id;
    t.setAttribute('aria-selected', on);
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
  history.replaceState(null, '', id === 'tab-csv' ? '#import' : '#api');
  rerenderAll();
}
tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.id)));

// ---------- Utilitaires d'affichage ----------
for (const sel of document.querySelectorAll('[data-cap]')) {
  sel.add(new Option('Automatique (sans plafond)', '0'));
  for (const k of CAP_OPTIONS) sel.add(new Option(`${k} kVA (${(k * 1000).toLocaleString('fr-FR')} W)`, String(k * 1000)));
}

const fmt = (n, d = 0) => n.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });

function renderKpis(el, s, m) {
  if (!s) { el.replaceChildren(); return; }
  const at = s.peakAt;
  const peakWhen = `${String(at.getUTCDate()).padStart(2, '0')}/${String(at.getUTCMonth() + 1).padStart(2, '0')} à ${String(at.getUTCHours()).padStart(2, '0')}h${String(at.getUTCMinutes()).padStart(2, '0')}`;
  const tiles = [
    ['Période', `${s.days} j`, `${s.from.split('-').reverse().join('/')} → ${s.to.split('-').reverse().join('/')}`],
    ['Énergie consommée', `${fmt(s.energyKWh, s.energyKWh < 100 ? 1 : 0)} kWh`, `soit ${fmt(s.avgKWhPerDay, 1)} kWh/jour`],
    ['Pic de puissance', `${fmt(s.peakW)} W`, `le ${peakWhen}`],
  ];
  if (m) {
    tiles.push(
      ['Valorisation au prix de gros', `${fmt(m.cost, 2)} €`, 'Σ énergie × prix day-ahead (hors réseau et taxes)'],
      ['Prix capté', `${fmt(m.captured)} €/MWh`, `prix moyen du marché : ${fmt(m.market)} €/MWh`],
      ['Facteur de forme', `× ${fmt(m.shape, 2)}`, m.shape > 1 ? 'tu consommes plutôt quand c’est cher' : 'tu consommes plutôt quand c’est bon marché'],
    );
  }
  el.replaceChildren(...tiles.map(([label, value, sub]) => {
    const div = document.createElement('div');
    div.className = 'kpi';
    div.innerHTML = `<span class="kpi-label"></span><span class="kpi-value"></span><span class="kpi-sub"></span>`;
    div.children[0].textContent = label;
    div.children[1].textContent = value;
    div.children[2].textContent = sub;
    return div;
  }));
}

/** Un « panneau » = formulaire + zone de résultat d'un onglet. */
function makePanel(panelEl, { getOptions, filePrefix, aggEl, capEl }) {
  const state = { points: null, chart: null, priced: null, priceError: '', demo: false, loadId: 0 };
  const chartEl = panelEl.querySelector('[data-chart]');
  const kpisEl = panelEl.querySelector('[data-kpis]');
  const exportsEl = panelEl.querySelector('[data-exports]');
  const statusEl = panelEl.querySelector('[data-status]');
  const marketEl = panelEl.querySelector('[data-market]');
  const marketNoteEl = panelEl.querySelector('[data-market-note]');
  const profileEl = panelEl.querySelector('[data-profile]');
  const dailyEl = panelEl.querySelector('[data-daily]');

  /** Charge les prix couvrant les mesures (fictifs pour les données d'exemple), puis redessine. */
  async function loadPrices() {
    const id = ++state.loadId;
    const points = state.points;
    let prices;
    try {
      if (state.demo) prices = demoPrices(points);
      else {
        const { debut, fin } = priceRange(points);
        const key = `optiwatt.prix|${debut}|${fin}`;
        const cached = cache.get(key);
        if (cached) prices = new Map(cached);
        else {
          prices = await fetchDayAhead({ baseUrl: relayUrl(), debut, fin });
          cache.set(key, [...prices]);
        }
      }
      if (id !== state.loadId) return;
      state.priced = attachPrices(points, prices);
    } catch (err) {
      if (id !== state.loadId) return;
      state.priceError = err.message;
    }
    panel.render();
  }

  function renderMarket(step, width) {
    const m = state.priced && summarizeMarket(state.priced);
    if (!m) {
      marketEl.hidden = !state.priceError;
      marketNoteEl.textContent = state.priceError;
      marketNoteEl.dataset.kind = 'error';
      profileEl.replaceChildren();
      dailyEl.replaceChildren();
      return null;
    }
    marketEl.hidden = false;
    marketNoteEl.dataset.kind = '';
    marketNoteEl.textContent = (state.demo ? 'Prix fictifs (données d’exemple).' : 'Prix day-ahead France, source ENTSO-E (pas de 15 min, moyennés sur chaque mesure).') +
      (m.coverage < 0.999 ? ` Prix disponibles pour ${fmt(m.coverage * 100)} % des mesures.` : '');
    profileEl.replaceChildren(profileChart(
      aggregate(state.priced, { step, metric: 'power', agg: 'mean' }),
      aggregate(state.priced, { step, metric: 'price' }),
      { width },
    ));
    dailyEl.replaceChildren(dailyCostChart(aggregate(state.priced, { step: 60, metric: 'cost' }), { width }));
    return m;
  }

  const panel = {
    state,
    status(msg, kind = '') { statusEl.textContent = msg; statusEl.dataset.kind = kind; },
    setPoints(points, { demo = false } = {}) {
      Object.assign(state, { points, demo, priced: null, priceError: '' });
      panel.render();
      loadPrices();
    },
    render() {
      if (panelEl.hidden) return;
      if (!state.points) { chartEl.replaceChildren(placeholder('Aucune donnée à afficher pour le moment.')); return; }
      const { view, cap, agg, step, metric } = getOptions();
      const power = metric === 'power';
      // Agrégation sans effet si chaque case ne contient qu'une mesure (ex. pas de 30 min sur une courbe Linky),
      // ou pour le prix (toujours moyenné) et le coût (toujours sommé)
      const single = step <= stepMinutes(state.points);
      aggEl.disabled = single || !power;
      aggEl.title = !power ? 'Prix moyenné et coût sommé sur chaque case' : single ? 'Une seule mesure par case à ce pas de temps : rien à agréger' : '';
      capEl.disabled = !power;
      const width = chartEl.clientWidth || 720;
      const market = renderMarket(step, width);
      renderKpis(kpisEl, summarize(state.points), market);
      if (!power && !state.priced) {
        state.chart = null;
        exportsEl.hidden = true;
        chartEl.replaceChildren(placeholder(state.priceError || 'Chargement des prix de marché…'));
        return;
      }
      const rows = aggregate(power ? state.points : state.priced, { agg, cap, step, metric });
      state.chart = view === 'month' ? monthHeatmap(rows, { cap, width }) : longHeatmap(rows, { cap, width });
      chartEl.replaceChildren(state.chart);
      exportsEl.hidden = false;
    },
  };
  exportsEl.addEventListener('click', (e) => {
    const kind = e.target.dataset.export;
    if (!kind || !state.chart) return;
    const name = `${filePrefix}-${new Date().toISOString().slice(0, 10)}`;
    if (kind === 'png') exportPng(state.chart, `${name}.png`);
    if (kind === 'svg') exportSvg(state.chart, `${name}.svg`);
    if (kind === 'csv') exportCsv(toCsv(state.points), `${name}.csv`);
  });
  return panel;
}

// ---------- Onglet API ----------
const apiForm = document.getElementById('api-form');
const apiPanel = makePanel(document.getElementById('panel-api'), {
  filePrefix: 'optiwatt-courbe',
  aggEl: apiForm.agg,
  capEl: apiForm.cap,
  getOptions: () => ({ view: 'long', cap: +apiForm.cap.value, agg: apiForm.agg.value, step: +apiForm.step.value, metric: apiForm.metric.value }),
});

(function initApiForm() {
  const saved = store.get(STORE_KEY, {});
  apiForm.prm.value = saved.prm ?? '';
  apiForm.token.value = saved.token ?? '';
  apiForm.remember.checked = Boolean(saved.prm);
  apiForm.cap.value = String(saved.cap ?? 6000);
  // Les anciennes URL de Worker Cloudflare (bloqué par conso.boris.sh) sont ignorées
  const savedProxy = saved.proxy && !/workers\.dev/.test(saved.proxy) ? saved.proxy : '';
  apiForm.proxy.value = savedProxy || ENV_PROXY;
  apiForm.end.value = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ en heure locale
  apiForm.end.max = apiForm.end.value;
  apiForm.days.addEventListener('input', () => (apiForm.daysOut.value = apiForm.days.value));
  apiForm.querySelector('[data-toggle-token]').addEventListener('click', () => {
    apiForm.token.type = apiForm.token.type === 'password' ? 'text' : 'password';
  });
  for (const name of ['cap', 'agg', 'step', 'metric']) apiForm[name].addEventListener('change', () => apiPanel.render());
})();

apiForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prm = apiForm.prm.value.trim();
  const token = apiForm.token.value.trim();
  const proxy = apiForm.proxy.value.trim();
  const { dateDebut, dateFin } = apiRange(apiForm.end.value, +apiForm.days.value);

  store.set(STORE_KEY, apiForm.remember.checked
    ? { prm, token, cap: +apiForm.cap.value, proxy }
    : { cap: +apiForm.cap.value, proxy });

  const key = `optiwatt.cache|${prm}|${dateDebut}|${dateFin}`;
  const cached = cache.get(key);
  if (cached) {
    apiPanel.setPoints(cached.map((p) => ({ t: new Date(p.t), v: p.v })));
    apiPanel.status('Données issues du cache de la session (aucun nouvel appel).', 'ok');
    return;
  }

  const btn = apiForm.querySelector('[type=submit]');
  btn.disabled = true;
  apiPanel.status('Récupération des données…');
  try {
    const points = await fetchLoadCurve({ prm, token, dateDebut, dateFin, baseUrl: proxy });
    cache.set(key, points);
    apiPanel.setPoints(points);
    const origin = points.fromRelayCache ? ' — servies par le cache du relais, sans nouvel appel à Enedis' : '';
    apiPanel.status(`${points.length} mesures reçues (${dateDebut} → ${dateFin})${origin}.`, 'ok');
  } catch (err) {
    apiPanel.status(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- Onglet CSV ----------
const csvForm = document.getElementById('csv-form');
const csvPanel = makePanel(document.getElementById('panel-csv'), {
  filePrefix: 'optiwatt-enedis',
  aggEl: csvForm.agg,
  capEl: csvForm.cap,
  getOptions: () => ({ view: csvForm.view.value, cap: +csvForm.cap.value, agg: csvForm.agg.value, step: +csvForm.step.value, metric: csvForm.metric.value }),
});
csvForm.cap.value = '0';
for (const name of ['view', 'cap', 'agg', 'step', 'metric']) csvForm[name].addEventListener('change', () => csvPanel.render());

csvForm.file.addEventListener('change', async () => {
  const file = csvForm.file.files[0];
  if (!file) return;
  try {
    const points = parseEnedisCsv(await file.text());
    csvPanel.setPoints(points);
    csvPanel.status(`${file.name} : ${points.length.toLocaleString('fr-FR')} mesures importées.`, 'ok');
  } catch (err) {
    csvPanel.status(err.message, 'error');
  }
});
csvForm.querySelector('[data-demo]').addEventListener('click', () => {
  csvPanel.setPoints(demoPoints(), { demo: true });
  csvPanel.status("Données d'exemple fictives (365 jours).", 'ok');
});

// ---------- Rendu initial et redimensionnement ----------
function rerenderAll() { apiPanel.render(); csvPanel.render(); }
let resizeTimer;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth) return;
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(rerenderAll, 200);
});

selectTab(location.hash === '#import' ? 'tab-csv' : 'tab-api');
if (new URLSearchParams(location.search).has('demo')) {
  selectTab('tab-csv');
  csvForm.querySelector('[data-demo]').click();
}
