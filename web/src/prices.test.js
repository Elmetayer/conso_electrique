import { describe, expect, it } from 'vitest';
import { aggregate, parseTimestamp } from './data.js';
import { attachPrices, capturedBy, capturedUnit, compareOffer, demoLoads, demoPrices, parseEuro, parsePriceResponse, pointsIn, priceRange, summarizeMarket, weekWindows } from './prices.js';

const T = (s) => parseTimestamp(s);
const ms = (s) => T(s).getTime();

// Prix au quart d'heure (début d'intervalle) de 00:00 à 01:00
const RESPONSE = { points: [['2026-11-20T00:00', 40], ['2026-11-20T00:15', 60], ['2026-11-20T00:30', 100], ['2026-11-20T00:45', -20]] };

describe('parsePriceResponse', () => {
  it('indexe par début de quart d’heure et moyenne les doublons', () => {
    const { prices: m, loads } = parsePriceResponse({ points: [...RESPONSE.points, ['2026-11-20T00:00', 50, 60000]] });
    expect(m.get(ms('2026-11-20 00:00'))).toBe(45);
    expect(m.size).toBe(4);
    expect(loads.get(ms('2026-11-20 00:00'))).toBe(60000);
    expect(loads.size).toBe(1);
  });
});

describe('attachPrices', () => {
  it('associe à une mesure Linky (fin d’intervalle) la moyenne des quarts d’heure couverts', () => {
    const { prices } = parsePriceResponse(RESPONSE);
    const pts = attachPrices([
      { t: T('2026-11-20 00:30'), v: 1000 },
      { t: T('2026-11-20 01:00'), v: 2000 },
      { t: T('2026-11-20 01:30'), v: 500 },
    ], prices);
    expect(pts.map((p) => p.p)).toEqual([50, 40, null]);
  });
});

describe('summarizeMarket et agrégation', () => {
  const pts = attachPrices([
    { t: T('2026-11-20 00:30'), v: 1000 }, // 0,5 kWh à 50 €/MWh = 0,025 €
    { t: T('2026-11-20 01:00'), v: 3000 }, // 1,5 kWh à 40 €/MWh = 0,06 €
  ], parsePriceResponse(RESPONSE).prices);

  it('calcule coût, prix capté et facteur de forme', () => {
    const s = summarizeMarket(pts);
    expect(s.energyKWh).toBeCloseTo(2);
    expect(s.cost).toBeCloseTo(0.085);
    expect(s.captured).toBeCloseTo(42.5);
    expect(s.market).toBeCloseTo(45);
    expect(s.shape).toBeCloseTo(42.5 / 45);
  });

  it('agrège le prix (moyenne) et le coût (somme) par case', () => {
    const [price] = aggregate(pts, { step: 60, metric: 'price' });
    const [cost] = aggregate(pts, { step: 60, metric: 'cost', cap: 100 });
    expect(price.value).toBeCloseTo(45);
    expect(cost.value).toBeCloseTo(0.085);
    expect(cost.capped).toBe(false);
  });

  it('omet les cases sans prix', () => {
    expect(aggregate([{ t: T('2026-11-21 00:30'), v: 1, p: null }], { metric: 'cost' })).toEqual([]);
  });
});

describe('priceRange et demoPrices', () => {
  const pts = [{ t: T('2026-11-20 00:30'), v: 1 }, { t: T('2026-11-21 00:00'), v: 1 }];
  it('couvre toutes les mesures, fin exclusive', () => {
    expect(priceRange(pts)).toEqual({ debut: '2026-11-20', fin: '2026-11-21' });
  });
  it('génère un prix par quart d’heure, de façon reproductible', () => {
    const a = demoPrices(pts);
    expect(a.size).toBe(96);
    expect([...a.values()]).toEqual([...demoPrices(pts).values()]);
  });
});

describe('maquette A', () => {
  // 10 jours, 2 mesures par jour (00:30 et 01:00), 1 kW, prix 40 puis 60 €/MWh
  const pts = [];
  for (let d = 10; d < 20; d++) {
    pts.push({ t: T(`2026-11-${d} 00:30`), v: 1000, p: 40 }, { t: T(`2026-11-${d} 01:00`), v: 1000, p: d === 19 ? 160 : 60 });
  }
  it('fenêtres de 7 jours depuis la fin', () => {
    const w = weekWindows(pts);
    expect(w.map((x) => [x.from, x.last])).toEqual([['2026-11-13', '2026-11-19'], ['2026-11-10', '2026-11-12']]);
    expect(w[0].label).toBe('Du 13/11 au 19/11');
    expect(pointsIn(pts, w[1])).toHaveLength(6);
  });
  it('prix capté par jour et par semaine', () => {
    const days = capturedBy(pts, 'day');
    expect(days).toHaveLength(10);
    expect(days[0]).toMatchObject({ key: '2026-11-10', captured: 50, market: 50 });
    expect(days[9].captured).toBeCloseTo(100);
    const weeks = capturedBy(pts, 'week');
    expect(weeks.map((w) => w.key)).toEqual(['2026-11-09', '2026-11-16']);
    expect(capturedUnit(7)).toBe('day');
    expect(capturedUnit(60)).toBe('week');
    expect(capturedUnit(365)).toBe('month');
  });
  it('comparaison avec son offre', () => {
    expect(parseEuro('0,2')).toBe(0.2);
    expect(parseEuro('abc')).toBeNull();
    const c = compareOffer({ energyKWh: 100, cost: 8 }, 0.2);
    expect(c.offerCost).toBeCloseTo(20);
    expect(c.gap).toBeCloseTo(12);
    expect(c.spotShare).toBeCloseTo(0.4);
  });
});

describe('prix de marché pondéré par la consommation France', () => {
  // Quart d'heure à 40 €/MWh avec 30 GW, puis 3 quarts d'heure à 100 €/MWh avec 60 GW
  const json = { points: [['2026-11-20T00:00', 40, 30000], ['2026-11-20T00:15', 100, 60000], ['2026-11-20T00:30', 100, 60000], ['2026-11-20T00:45', 100, 60000]] };
  const { prices, loads } = parsePriceResponse(json);
  const pts = attachPrices([{ t: T('2026-11-20 00:30'), v: 2000 }, { t: T('2026-11-20 01:00'), v: 1000 }], prices, loads);

  it('même calcul que le prix capté : moyenne des prix pondérée par le volume', () => {
    // France : (40×30 + 100×60 + 100×60 + 100×60) / (30+60+60+60) = 91,43 €/MWh
    const s = summarizeMarket(pts);
    expect(s.marketKind).toBe('france');
    expect(s.market).toBeCloseTo(19200 / 210, 2);
    // toi : 1 kWh à 70 €/MWh (moyenne simple des 2 quarts d'heure), 0,5 kWh à 100 €/MWh
    expect(s.captured).toBeCloseTo((1 * 70 + 0.5 * 100) / 1.5, 6);
    expect(s.shape).toBeCloseTo(s.captured / s.market);
  });

  it('repli sur la moyenne simple si la conso France manque', () => {
    const partial = attachPrices([{ t: T('2026-11-20 00:30'), v: 2000 }], prices, new Map());
    const s = summarizeMarket(partial);
    expect(s.marketKind).toBe('simple');
    expect(s.market).toBeCloseTo(70);
  });

  it('conso France fictive pour les données d’exemple', () => {
    const l = demoLoads(new Map([[ms('2026-01-15 19:30'), 100], [ms('2026-07-15 04:00'), 50]]));
    expect(l.get(ms('2026-01-15 19:30'))).toBeGreaterThan(l.get(ms('2026-07-15 04:00')));
  });
});
