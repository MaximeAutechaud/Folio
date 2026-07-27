import { describe, expect, it } from 'vitest';
import { breadthDelta, breadthSeries, etfMomentum, pairedSeries } from './breadth';
import type { Bar } from './scanner';

const DAY = 86_400;
const T0 = 1_200_000_000;

/** Série à valeurs imposées, calendrier régulier. */
function bars(values: number[], startIndex = 0): Bar[] {
  return values.map((value, i) => ({
    time: T0 + (i + startIndex) * DAY,
    open: value,
    value,
    close: value,
    volume: 1_000_000,
  }));
}

function timeline(length: number, startIndex = 0): number[] {
  return Array.from({ length }, (_, i) => T0 + (i + startIndex) * DAY);
}

describe('breadthSeries', () => {
  it('ne compte un titre qu’une fois sa moyenne mobile calculable', () => {
    const rising = bars([1, 2, 3, 4, 5]);
    const series = breadthSeries([rising], timeline(5), 3);

    // MM3 disponible à partir de la 3e bougie : deux points à effectif nul.
    expect(series.map(p => p.count)).toEqual([0, 0, 1, 1, 1]);
    expect(series.map(p => p.pctAbove)).toEqual([0, 0, 100, 100, 100]);
  });

  it('mesure la part au-dessus de la MM, pas la part en hausse', () => {
    const up = bars([10, 10, 10, 20]); // 20 > MM3 (13,33)
    const down = bars([10, 10, 10, 5]); // 5 < MM3 (8,33)
    const series = breadthSeries([up, down], timeline(4), 3);

    expect(series[3]).toEqual({ time: T0 + 3 * DAY, pctAbove: 50, count: 2 });
  });

  it('exclut un titre absent ce jour-là au lieu de reporter sa dernière valeur', () => {
    const full = bars([10, 10, 10, 20, 20]);
    // Trou à l'indice 3 : le titre saute une séance du calendrier de référence.
    const gapped: Bar[] = [
      ...bars([10, 10, 10]),
      ...bars([20], 4),
    ];

    const series = breadthSeries([full, gapped], timeline(5), 3);

    // Le jour du trou, seul `full` compte — et non deux titres dont un figé.
    expect(series[3].count).toBe(1);
    expect(series[3].pctAbove).toBe(100);
    // La séance suivante, `gapped` a de nouveau ses trois valeurs.
    expect(series[4].count).toBe(2);
  });

  it('suit le calendrier de référence et non l’union des dates des membres', () => {
    const member = bars([1, 2, 3, 4, 5]);
    const series = breadthSeries([member], timeline(3), 3);

    expect(series).toHaveLength(3);
    expect(series.at(-1)?.time).toBe(T0 + 2 * DAY);
  });

  it('rend un effectif nul plutôt qu’un NaN quand aucun membre n’est éligible', () => {
    const tooShort = bars([1, 2]);
    const series = breadthSeries([tooShort], timeline(2), 50);

    expect(series.every(p => p.count === 0)).toBe(true);
    expect(series.every(p => Number.isFinite(p.pctAbove))).toBe(true);
  });

  it('expose la dérive d’effectif qui signe le biais de survivance', () => {
    const ancien = bars([10, 10, 10, 10, 10, 10]);
    // Titre coté plus tard : absent des premières séances du calendrier.
    const recent = bars([10, 10, 10, 12], 2);
    const series = breadthSeries([ancien, recent], timeline(6), 3);

    // L'effectif croît avec le temps : comparer les niveaux de 2009 et de 2024
    // reviendrait à comparer deux populations différentes.
    expect(series.map(p => p.count)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('breadthDelta', () => {
  it('rend la variation en points de pourcentage', () => {
    const series = [30, 40, 55, 50].map((pctAbove, i) => ({
      time: T0 + i * DAY,
      pctAbove,
      count: 100,
    }));

    expect(breadthDelta(series, 2)).toEqual([null, null, 25, 10]);
  });

  it('distingue « pas encore calculable » de « variation nulle »', () => {
    const series = [50, 50, 50].map((pctAbove, i) => ({
      time: T0 + i * DAY,
      pctAbove,
      count: 100,
    }));

    const delta = breadthDelta(series, 1);
    expect(delta[0]).toBeNull();
    expect(delta[1]).toBe(0);
  });
});

describe('etfMomentum', () => {
  it('calcule la performance sur la fenêtre demandée', () => {
    const etf = bars([100, 101, 110, 121]);
    expect(etfMomentum(etf, 2)).toEqual([null, null, 10, expect.closeTo(19.802, 3)]);
  });

  it('partage la convention de décalage de breadthDelta', () => {
    const etf = bars([100, 101, 102, 103, 104]);
    const series = etf.map((b, i) => ({ time: b.time, pctAbove: i * 10, count: 100 }));

    const momentum = etfMomentum(etf, 3);
    const delta = breadthDelta(series, 3);

    // Les deux séries deviennent définies exactement au même indice, sans quoi
    // toute corrélation serait mesurée sur des dates décalées.
    expect(momentum.findIndex(v => v != null)).toBe(delta.findIndex(v => v != null));
  });
});

describe('pairedSeries', () => {
  it('n’garde que les indices définis des deux côtés', () => {
    const { a, b } = pairedSeries([null, 1, 2, null, 4], [null, 10, null, 30, 40]);
    expect(a).toEqual([1, 4]);
    expect(b).toEqual([10, 40]);
  });

  it('s’arrête à la plus courte des deux séries', () => {
    const { a, b } = pairedSeries([1, 2, 3], [10, 20]);
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([10, 20]);
  });
});
