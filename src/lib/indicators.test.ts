import { describe, it, expect } from 'vitest';
import { calcEma, calcMa, calcRsi, calcRsiSeries } from './indicators';

describe('calcMa', () => {
  it('null si moins de points que la période', () => {
    expect(calcMa([1, 2], 3)).toBeNull();
  });

  it('moyenne des N derniers points seulement', () => {
    expect(calcMa([100, 1, 2, 3], 3)).toBe(2);
  });

  it('période = longueur → moyenne simple', () => {
    expect(calcMa([1, 2, 3, 4], 4)).toBe(2.5);
  });
});

describe('calcEma', () => {
  it('null si moins de points que la période', () => {
    expect(calcEma([1, 2], 3)).toBeNull();
  });

  it('série constante → EMA = la constante', () => {
    expect(calcEma([50, 50, 50, 50, 50], 3)).toBe(50);
  });

  it('période = longueur → SMA (seed sans itération)', () => {
    expect(calcEma([1, 2, 3], 3)).toBe(2);
  });

  it('valeurs connues : [1..5] période 3 → 4', () => {
    // seed SMA(1,2,3)=2 ; k=0.5 ; 4*0.5+2*0.5=3 ; 5*0.5+3*0.5=4
    expect(calcEma([1, 2, 3, 4, 5], 3)).toBe(4);
  });

  it('l EMA pondère plus les points récents que la MA', () => {
    const rising = [10, 10, 10, 10, 10, 10, 10, 10, 20, 30];
    expect(calcEma(rising, 5)!).toBeGreaterThan(calcMa(rising, 10)!);
  });
});

describe('calcRsi', () => {
  it('null si données insuffisantes (période + 1 requis)', () => {
    expect(calcRsi([1, 2, 3], 14)).toBeNull();
    expect(calcRsi(Array.from({ length: 14 }, (_, i) => i), 14)).toBeNull();
  });

  it('hausse continue → 100', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(calcRsi(prices)).toBe(100);
  });

  it('baisse continue → 0', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(calcRsi(prices)).toBe(0);
  });

  it('gains et pertes symétriques → ~50', () => {
    // Alternance +1/−1 : avgGain ≈ avgLoss ; le lissage de Wilder penche
    // très légèrement du côté du dernier mouvement, d'où l'encadrement.
    const prices = Array.from({ length: 31 }, (_, i) => 100 + (i % 2));
    const rsi = calcRsi(prices)!;
    expect(rsi).toBeGreaterThanOrEqual(49);
    expect(rsi).toBeLessThanOrEqual(51);
  });

  it('reste borné entre 0 et 100 sur des données bruitées', () => {
    // Pseudo-aléatoire déterministe (LCG) — pas de flakiness
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const prices = Array.from({ length: 100 }, () => 100 + rand() * 20);
    const rsi = calcRsi(prices)!;
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
  });

  it('lissage de Wilder : valeur connue sur un petit dataset', () => {
    // Période 2, prix [10, 11, 10, 12] : changes = [+1, −1, +2]
    // seed : avgGain=(1+0)/2=0.5, avgLoss=(0+1)/2=0.5
    // itération (+2) : avgGain=(0.5*1+2)/2=1.25, avgLoss=(0.5*1+0)/2=0.25
    // RS=5 → RSI = 100 − 100/6 ≈ 83.33 → round = 83
    expect(calcRsi([10, 11, 10, 12], 2)).toBe(83);
  });
});

describe('calcRsiSeries', () => {
  const toPoints = (prices: number[]) => prices.map((value, i) => ({ time: i, value }));

  it('série vide si données insuffisantes', () => {
    expect(calcRsiSeries(toPoints([1, 2, 3]), 14)).toEqual([]);
  });

  it('un point par bougie à partir de l index `period`', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i));
    const series = calcRsiSeries(toPoints(prices), 14);
    expect(series).toHaveLength(30 - 14);
    expect(series[0].time).toBe(14);
    expect(series[series.length - 1].time).toBe(29);
  });

  it('le dernier point de la série ≈ calcRsi sur les mêmes prix', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const prices = Array.from({ length: 60 }, () => 100 + rand() * 10);
    const series = calcRsiSeries(toPoints(prices), 14);
    const single = calcRsi(prices, 14)!;
    // calcRsi arrondit à l entier, la série à 2 décimales
    expect(Math.abs(series[series.length - 1].value - single)).toBeLessThanOrEqual(0.5);
  });

  it('toutes les valeurs bornées entre 0 et 100', () => {
    let seed = 99;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const prices = Array.from({ length: 100 }, () => 50 + rand() * 50);
    for (const { value } of calcRsiSeries(toPoints(prices), 14)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});
