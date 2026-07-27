import { describe, expect, it } from 'vitest';
import { BREAKOUT_POC, alignedResidualReturns, runBreakoutPoc } from './scannerPoc';
import { correlation, type Bar } from './scanner';

const DAY = 86_400;

function series(
  tickerSeed: number,
  breakout = false,
  volumeBoost = false,
): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < 300; i++) {
    const base = 100 + Math.sin((i + tickerSeed) / 7) * 0.35 + i * 0.002;
    const value = breakout && i >= 292
      ? 101 + (i - 292) * 0.55 + Math.sin((i + tickerSeed) / 3) * 0.05
      : base;
    const volume = volumeBoost && i >= 290
      ? 300_000
      : 100_000 + ((i + tickerSeed) % 5) * 3_000;
    out.push({
      time: 1_700_000_000 + i * DAY,
      open: value * 0.998,
      value,
      close: value,
      volume,
    });
  }
  return out;
}

describe('BREAKOUT_POC', () => {
  it('fige la configuration centrale annoncée', () => {
    expect(BREAKOUT_POC.breakout.pivotBars).toBe(120);
    expect(BREAKOUT_POC.breakout.maxBarsSinceBreakout).toBe(10);
    expect(BREAKOUT_POC.pool.bars).toBe(15);
    expect(BREAKOUT_POC.universe.minMedianDollarVolume60).toBe(10_000_000);
    expect(BREAKOUT_POC.cluster.minSize).toBe(3);
    expect(BREAKOUT_POC.cluster.minPairCorrelation).toBe(0.40);
    expect(BREAKOUT_POC.cluster.minCohesion).toBe(0.45);
  });

  it('rejette un univers sans cassure ni expansion de liquidité', () => {
    const control = series(0);
    const result = runBreakoutPoc(
      { SPY: control, XLK: control, AAA: series(1) },
      t => t === 'SPY' || t === 'XLK',
      { marketTicker: 'SPY', sectorOf: () => 'xlk', etfOf: () => 'XLK' },
    );
    expect(result.candidates).toEqual([]);
    expect(result.clusters).toEqual([]);
  });

  it('détecte des cassures collectives et produit un cluster scoré', () => {
    const control = series(0);
    const result = runBreakoutPoc(
      {
        SPY: control,
        XLK: series(2),
        AAA: series(1, true, true),
        BBB: series(1, true, true),
        CCC: series(1, true, true),
      },
      t => t === 'SPY' || t === 'XLK',
      { marketTicker: 'SPY', sectorOf: () => 'xlk', etfOf: () => 'XLK' },
    );
    expect(result.candidates.map(c => c.ticker).sort()).toEqual(['AAA', 'BBB', 'CCC']);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].tickers).toEqual(['AAA', 'BBB', 'CCC']);
    expect(result.clusters[0].cohesion).toBeGreaterThanOrEqual(BREAKOUT_POC.cluster.minCohesion);
    expect(result.clusters[0].score).toBeGreaterThanOrEqual(0);
    expect(result.clusters[0].score).toBeLessThanOrEqual(100);
  });

  it('aligne les corrélations par timestamp en tolérant une bougie manquante', () => {
    const control = series(0);
    const aaa = series(1, true, true);
    const bbb = series(1, true, true);
    bbb.splice(250, 1);
    const sector = series(2);
    const a = alignedResidualReturns(aaa, control, sector);
    const b = alignedResidualReturns(bbb, control, sector);
    const bByTime = new Map(b.map(x => [x.time, x.value]));
    const av: number[] = [];
    const bv: number[] = [];
    for (const x of a) {
      const y = bByTime.get(x.time);
      if (y != null) { av.push(x.value); bv.push(y); }
    }
    expect(av).toHaveLength(297);
    expect(correlation(av, bv)).toBeGreaterThan(0.999);
  });
});
