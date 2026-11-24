import { describe, expect, it } from 'vitest';
import { aggregate, parseTimestamp } from './data.js';
import { attachPrices, demoPrices, parsePriceResponse, priceRange, summarizeMarket } from './prices.js';

const T = (s) => parseTimestamp(s);
const ms = (s) => T(s).getTime();

// Prix au quart d'heure (début d'intervalle) de 00:00 à 01:00
const RESPONSE = { points: [['2026-11-20T00:00', 40], ['2026-11-20T00:15', 60], ['2026-11-20T00:30', 100], ['2026-11-20T00:45', -20]] };

describe('parsePriceResponse', () => {
  it('indexe par début de quart d’heure et moyenne les doublons', () => {
    const m = parsePriceResponse({ points: [...RESPONSE.points, ['2026-11-20T00:00', 50]] });
    expect(m.get(ms('2026-11-20 00:00'))).toBe(45);
    expect(m.size).toBe(4);
  });
});

describe('attachPrices', () => {
  it('associe à une mesure Linky (fin d’intervalle) la moyenne des quarts d’heure couverts', () => {
    const prices = parsePriceResponse(RESPONSE);
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
  ], parsePriceResponse(RESPONSE));

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
