import { describe, expect, it } from 'vitest';
import { ACCELERATION_POC, runAccelerationPoc } from './scannerAcceleration';
import type { Bar } from './scanner';

const DAY = 86_400;

function bars(seed: number, accelerate = false, liquid = false): Bar[] {
  return Array.from({ length: 300 }, (_, i) => {
    const d = Math.max(0, i - 275);
    const value = 100 + i * 0.02 + Math.sin((i + seed) / 9) * 0.15
      + (accelerate ? d * d * 0.025 : 0);
    return {
      time: 1_700_000_000 + i * DAY,
      open: value * 0.999,
      value,
      close: value,
      volume: liquid && i >= 290 ? 320_000 : 110_000 + ((i + seed) % 7) * 2_000,
    };
  });
}

describe('ACCELERATION_POC', () => {
  it('fige les paramètres annoncés avant rejeu', () => {
    expect(ACCELERATION_POC.acceleration.minNormalizedAcceleration).toBe(0.5);
    expect(ACCELERATION_POC.acceleration.minTrueDays).toBe(3);
    expect(ACCELERATION_POC.acceleration.persistenceWindow).toBe(5);
    expect(ACCELERATION_POC.relativeStrength.referenceAccelerationPercentile).toBe(70);
    expect(ACCELERATION_POC.cluster.minSize).toBe(3);
    expect(ACCELERATION_POC.cluster.minCohesion).toBe(0.45);
    expect(ACCELERATION_POC.cluster.minAccelerationBreadth).toBe(0.50);
    expect(ACCELERATION_POC.cluster.minLiquidityFreshness).toBe(0.50);
  });

  it('rejette une tendance régulière sans accélération ni régime de liquidité', () => {
    const control = bars(0);
    const result = runAccelerationPoc(
      { SPY: control, XLK: bars(2), AAA: bars(1) },
      t => t === 'SPY' || t === 'XLK',
      { marketTicker: 'SPY', sectorOf: () => 'xlk', etfOf: () => 'XLK' },
    );
    expect(result.candidates).toEqual([]);
    expect(result.clusters).toEqual([]);
  });

  it('détecte une accélération collective persistante', () => {
    const control = bars(0);
    const result = runAccelerationPoc(
      {
        SPY: control,
        XLK: bars(2),
        AAA: bars(1, true, true),
        BBB: bars(1, true, true),
        CCC: bars(1, true, true),
      },
      t => t === 'SPY' || t === 'XLK',
      { marketTicker: 'SPY', sectorOf: () => 'xlk', etfOf: () => 'XLK' },
    );
    expect(result.candidates.map(c => c.ticker).sort()).toEqual(['AAA', 'BBB', 'CCC']);
    expect(result.candidates.every(c => c.trueDays >= 3)).toBe(true);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].tickers).toEqual(['AAA', 'BBB', 'CCC']);
    expect(result.clusters[0].score).toBeGreaterThan(0);
  });

  it('conserve les rangs moyens comme pistes au lieu de les filtrer', () => {
    const control = bars(0);
    const result = runAccelerationPoc(
      {
        SPY: control,
        XLK: bars(2),
        FORT: bars(1, true, true),
        MOYEN: bars(3, true, true),
        FAIBLE: bars(5, true, true),
      },
      t => t === 'SPY' || t === 'XLK',
      { marketTicker: 'SPY', sectorOf: () => 'xlk', etfOf: () => 'XLK' },
    );
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.some(c => c.accelerationPercentile < 70)).toBe(true);
  });

  it('classe les percentiles sur l’univers éligible et non sur le réservoir qualifié', () => {
    const series: Record<string, Bar[]> = { SPY: bars(0), XLK: bars(2) };
    for (const [i, t] of ['AAA', 'BBB', 'CCC'].entries()) series[t] = bars(1 + i * 0, true, true);
    // Instruments éligibles mais non qualifiés : ils appartiennent quand même
    // au dénominateur du rang transversal.
    for (let i = 0; i < 5; i++) series[`FLAT${i}`] = bars(10 + i);

    const result = runAccelerationPoc(
      series,
      t => t === 'SPY' || t === 'XLK',
      { marketTicker: 'SPY', sectorOf: () => 'xlk', etfOf: () => 'XLK' },
    );

    expect(result.candidates).toHaveLength(3);
    expect(result.referenceUniverse).toHaveLength(8);
    // Sur un dénominateur large, les trois accélérations occupent le haut du
    // classement. Sur le seul réservoir qualifié, la dernière tombait à 33.
    expect(result.candidates.every(c => c.accelerationPercentile >= 70)).toBe(true);
  });

  it('expose une largeur d’accélération et une fraîcheur de liquidité non dégénérées', () => {
    const result = runAccelerationPoc(
      {
        SPY: bars(0),
        XLK: bars(2),
        AAA: bars(1, true, true),
        BBB: bars(1, true, true),
        CCC: bars(1, true, true),
      },
      t => t === 'SPY' || t === 'XLK',
      { marketTicker: 'SPY', sectorOf: () => 'xlk', etfOf: () => 'XLK' },
    );
    const cluster = result.clusters[0];
    expect(cluster).toBeDefined();
    // `passesNow` est mesuré à la dernière séance, pas déduit de `trueDays`,
    // qui est une condition d'admission et rendait le critère toujours vrai.
    expect(cluster.accelerationBreadth).toBe(
      result.candidates.filter(c => c.passesNow).length / result.candidates.length,
    );
    expect(cluster.liquidityFreshness).toBeLessThanOrEqual(1);
    expect(cluster.liquidityFreshness).toBeGreaterThanOrEqual(
      ACCELERATION_POC.cluster.minLiquidityFreshness,
    );
  });
});
