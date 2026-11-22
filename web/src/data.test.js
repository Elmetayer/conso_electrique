import { describe, expect, it } from 'vitest';
import { aggregateHourly, apiRange, parseApiResponse, parseEnedisCsv, parseTimestamp, summarize, toCsv } from './data.js';

const CSV = `Identifiant PRM;Type de donnees;Date de debut;Date de fin;Grandeur physique;Grandeur metier;Etape metier;Unite;Pas en minutes
12345678901234;Courbe de charge;01/04/2026;02/04/2026;Energie active;Consommation;Comptage Brut;W;
Horodate;Valeur
2026-04-01T00:30:00+02:00;400
2026-04-01T01:00:00+02:00;600
2026-04-01T01:30:00+02:00;13000
2026-04-01T02:00:00+02:00;1000
2026-04-01T02:30:00+02:00;
`;

describe('parseTimestamp', () => {
  it('lit les formats ISO, API et français en heure murale', () => {
    expect(parseTimestamp('2026-04-01T00:30:00+02:00').toISOString()).toBe('2026-04-01T00:30:00.000Z');
    expect(parseTimestamp('2026-04-01 00:30:00').toISOString()).toBe('2026-04-01T00:30:00.000Z');
    expect(parseTimestamp('01/04/2026 23:00').toISOString()).toBe('2026-04-01T23:00:00.000Z');
    expect(parseTimestamp('n/a')).toBeNull();
  });
});

describe('parseEnedisCsv', () => {
  it("ignore l'en-tête et les valeurs vides", () => {
    const pts = parseEnedisCsv(CSV);
    expect(pts).toHaveLength(4);
    expect(pts[0].v).toBe(400);
  });
  it('rejette un fichier sans mesures', () => {
    expect(() => parseEnedisCsv('a;b\nc;d')).toThrow(/Aucune mesure/);
  });
});

describe('aggregateHourly', () => {
  const pts = parseEnedisCsv(CSV);
  it("rattache la mesure de fin d'intervalle à l'heure de début (moyenne)", () => {
    const rows = aggregateHourly(pts, { agg: 'mean' });
    expect(rows.map((r) => [r.hour, r.value])).toEqual([[0, 500], [1, 7000]]);
  });
  it('applique le plafond et le signale', () => {
    const rows = aggregateHourly(pts, { agg: 'max', cap: 6000 });
    expect(rows[1]).toMatchObject({ hour: 1, raw: 13000, value: 6000, capped: true });
    expect(rows[0]).toMatchObject({ value: 600, capped: false });
  });
  it('gère le passage de minuit', () => {
    const rows = aggregateHourly([{ t: parseTimestamp('2026-04-02 00:00'), v: 1 }]);
    expect(rows[0]).toMatchObject({ date: '2026-04-01', hour: 23, month: '2026-04', day: 1 });
  });
});

describe('parseApiResponse', () => {
  it('lit le format conso.boris.sh 2026', () => {
    const { unit, points } = parseApiResponse({
      grandeur: [{ unite: 'W', points: [{ d: '2026-04-01 01:00:00', v: '250' }, { d: '2026-04-01 00:30:00', v: '200' }, { d: '2026-04-01 01:30:00', v: null }] }],
    });
    expect(unit).toBe('W');
    expect(points.map((p) => p.v)).toEqual([200, 250]);
  });
  it("accepte l'ancien format interval_reading", () => {
    expect(parseApiResponse({ interval_reading: [{ date: '2026-04-01 00:30:00', value: '10' }] }).points).toHaveLength(1);
  });
});

describe('summarize / toCsv / apiRange', () => {
  it("calcule l'énergie à partir du pas", () => {
    const s = summarize(parseEnedisCsv(CSV));
    expect(s.step).toBe(30);
    expect(s.energyKWh).toBeCloseTo((400 + 600 + 13000 + 1000) * 0.5 / 1000);
    expect(s.peakW).toBe(13000);
    expect(s.days).toBe(1);
  });
  it('produit un CSV réimportable', () => {
    const pts = parseEnedisCsv(CSV);
    expect(parseEnedisCsv(toCsv(pts))).toEqual(pts);
  });
  it('calcule les bornes de requête', () => {
    expect(apiRange('2026-11-22', 7)).toEqual({ dateDebut: '2026-11-15', dateFin: '2026-11-22' });
  });
});
