import { describe, it, expect } from 'vitest';
import {
  rangeFor,
  lastExpectedSession,
  toRows,
  toBars,
  buildReport,
  pruneBefore,
  toDateString,
  daysBetween,
  RETENTION_DAYS,
} from './priceCache';
import type { ScannerBar } from './api/yahoo';

const bar = (dateIso: string, over: Partial<ScannerBar> = {}): ScannerBar => ({
  time: Math.floor(Date.parse(`${dateIso}T20:00:00Z`) / 1000),
  open: 100,
  value: 101,
  close: 102,
  volume: 500_000,
  ...over,
});

describe('toDateString / daysBetween', () => {
  it('convertit en date UTC', () => {
    expect(toDateString(Date.parse('2026-07-26T20:00:00Z') / 1000)).toBe('2026-07-26');
  });

  it('compte les jours entre deux dates', () => {
    expect(daysBetween('2026-07-01', '2026-07-26')).toBe(25);
    expect(daysBetween('2026-07-26', '2026-07-26')).toBe(0);
  });

  it('resiste au passage a l heure d ete', () => {
    // Un changement d heure introduit une journee de 23 h : sans arrondi,
    // daysBetween renverrait 0,958 et le plan de sync deraperait d un jour.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('lastExpectedSession', () => {
  it('un jour de semaine est sa propre derniere seance attendue', () => {
    expect(lastExpectedSession('2026-07-24')).toBe('2026-07-24'); // vendredi
    expect(lastExpectedSession('2026-07-22')).toBe('2026-07-22'); // mercredi
  });

  it('le week-end renvoie au vendredi', () => {
    expect(lastExpectedSession('2026-07-25')).toBe('2026-07-24'); // samedi
    expect(lastExpectedSession('2026-07-26')).toBe('2026-07-24'); // dimanche
  });

  it('le lundi est sa propre seance, pas le vendredi precedent', () => {
    expect(lastExpectedSession('2026-07-27')).toBe('2026-07-27');
  });
});

describe('rangeFor', () => {
  it('ticker inconnu du cache → deux ans', () => {
    // Deux ans et non un : la profondeur excedentaire ne sert pas au scan mais
    // a sa validation, en laissant 125 seances de warm-up AVANT les themes a
    // detecter. Avec un an, la premiere date rejouable tombe apres eux.
    expect(rangeFor(undefined, '2026-07-26')).toBe('2y');
  });

  it('deja a jour → null, aucune requete', () => {
    expect(rangeFor('2026-07-24', '2026-07-24')).toBeNull();
  });

  it('le week-end ne relance rien si le cache tient le vendredi', () => {
    // Sans cette regle, un cache a jour paraissait en retard de deux jours le
    // dimanche et l'univers entier etait retelecharge pour ne rien apprendre —
    // deux jours sur sept, plus les feries.
    expect(rangeFor('2026-07-24', '2026-07-25')).toBeNull(); // samedi
    expect(rangeFor('2026-07-24', '2026-07-26')).toBeNull(); // dimanche
  });

  it('mais un cache reellement en retard est bien rattrape le week-end', () => {
    expect(rangeFor('2026-07-17', '2026-07-26')).not.toBeNull();
  });

  it('le lundi, la seance du jour est attendue', () => {
    expect(rangeFor('2026-07-24', '2026-07-27')).toBe('5d');
  });

  it('une date future dans le cache ne declenche pas de requete', () => {
    expect(rangeFor('2026-07-28', '2026-07-26')).toBeNull();
  });

  it('petit trou → fenetre courte', () => {
    expect(rangeFor('2026-07-23', '2026-07-27')).toBe('5d');
    expect(rangeFor('2026-07-10', '2026-07-27')).toBe('1mo');
  });

  it('la fenetre demandee recouvre toujours largement le trou', () => {
    // Le recouvrement est volontaire : une bougie deja connue est reecrite par
    // l upsert, alors qu un trou laisse beant fausse toutes les fenetres
    // glissantes qui le traversent.
    const cas: [string, string, number][] = [
      ['2026-07-23', '5d', 5],
      ['2026-07-10', '1mo', 30],
      ['2026-06-01', '3mo', 90],
      ['2026-03-15', '6mo', 180],
      ['2025-09-01', '1y', 365],
    ];
    for (const [latest, attendu, jours] of cas) {
      expect(rangeFor(latest, '2026-07-27')).toBe(attendu);
      expect(daysBetween(latest, '2026-07-27')).toBeLessThanOrEqual(jours);
    }
  });

  it('trou d environ un an → 1y', () => {
    expect(rangeFor('2025-10-01', '2026-07-27')).toBe('1y');
  });

  it('trou tres ancien → deux ans, sans tenter davantage', () => {
    expect(rangeFor('2020-01-01', '2026-07-27')).toBe('2y');
  });
});

describe('toRows / toBars', () => {
  it('convertit une bougie en ligne de table', () => {
    const [r] = toRows([bar('2026-07-24')]);
    expect(r.date).toBe('2026-07-24');
    expect(r.value).toBe(101);
    expect(r.volume).toBe(500_000);
  });

  it('aller-retour : les valeurs numeriques sont preservees', () => {
    const rows = toRows([bar('2026-07-24', { open: 10.5, value: 11.25, close: 11.3, volume: 42 })]);
    const [b] = toBars(rows.map(r => ({ ...r, ticker: 'AAA' })));
    expect(b.open).toBeCloseTo(10.5, 10);
    expect(b.value).toBeCloseTo(11.25, 10);
    expect(b.close).toBeCloseTo(11.3, 10);
    expect(b.volume).toBe(42);
  });

  it('aller-retour : la date ne derive pas d une seance', () => {
    // `time` est reconstruit a midi UTC, pas a minuit : minuit tombe la veille
    // dans les fuseaux negatifs et decalerait toutes les fenetres.
    for (const d of ['2026-01-02', '2026-07-24', '2026-12-31']) {
      const rows = toRows([bar(d)]).map(r => ({ ...r, ticker: 'AAA' }));
      expect(toDateString(toBars(rows)[0].time)).toBe(d);
    }
  });

  it('une ligne sans open ni close se replie sur la cloture ajustee', () => {
    const [b] = toBars([{ ticker: 'AAA', date: '2026-07-24', open: null, value: 50, close: null, volume: 1 }]);
    expect(b.open).toBe(50);
    expect(b.close).toBe(50);
  });

  it('serie vide', () => {
    expect(toRows([])).toEqual([]);
    expect(toBars([])).toEqual([]);
  });
});

describe('buildReport', () => {
  it('separe resolus et non resolus', () => {
    const r = buildReport([
      { ticker: 'AAA', ok: true, bars: 250 },
      { ticker: 'BBB', ok: false, bars: 0 },
      { ticker: 'CCC', ok: true, bars: 249 },
    ], 0);
    expect(r.requested).toBe(3);
    expect(r.resolved).toBe(2);
    expect(r.unresolved).toEqual(['BBB']);
    expect(r.bars).toBe(499);
  });

  it('les non resolus sont tries, pour que le rapport soit lisible', () => {
    const r = buildReport([
      { ticker: 'ZZZ', ok: false, bars: 0 },
      { ticker: 'AAA', ok: false, bars: 0 },
      { ticker: 'MMM', ok: false, bars: 0 },
    ], 0);
    expect(r.unresolved).toEqual(['AAA', 'MMM', 'ZZZ']);
  });

  it('les tickers deja a jour comptent dans requested sans etre des echecs', () => {
    const r = buildReport([{ ticker: 'AAA', ok: true, bars: 5 }], 899);
    expect(r.requested).toBe(900);
    expect(r.skipped).toBe(899);
    expect(r.unresolved).toEqual([]);
  });

  it('aucune tentative', () => {
    const r = buildReport([], 0);
    expect(r).toEqual({ requested: 0, resolved: 0, unresolved: [], bars: 0, skipped: 0 });
  });
});

describe('pruneBefore', () => {
  it('recule de la duree de retention', () => {
    expect(pruneBefore('2026-07-26', 400)).toBe('2025-06-21');
  });

  it('conserve plus d un an, marge incluse', () => {
    expect(RETENTION_DAYS).toBeGreaterThan(365);
    expect(daysBetween(pruneBefore('2026-07-26'), '2026-07-26')).toBe(RETENTION_DAYS);
  });

  it('traverse une annee bissextile sans deriver', () => {
    expect(daysBetween(pruneBefore('2024-03-01', 400), '2024-03-01')).toBe(400);
  });
});
