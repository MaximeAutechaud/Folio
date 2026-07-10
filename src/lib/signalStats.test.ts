import { describe, it, expect } from 'vitest';
import { computeSignalStats, isWin, LOW_SAMPLE_THRESHOLD, SIGNAL_KINDS } from './signalStats';
import type { SignalLogRow } from '../types';

let nextId = 1;
function row(
  signal: string,
  score: number,
  perfs: { j5?: number | null; j10?: number | null; j20?: number | null } = {},
): SignalLogRow {
  return {
    id: nextId++,
    date: '2026-07-01',
    scope: 'sector',
    scope_id: 'xlk',
    signal,
    score,
    rel_perf_j5: perfs.j5 ?? null,
    rel_perf_j10: perfs.j10 ?? null,
    rel_perf_j20: perfs.j20 ?? null,
  };
}

describe('isWin', () => {
  it('signaux haussiers : gagné si relPerf > 0', () => {
    for (const s of ['dip', 'reversal', 'accelerating'] as const) {
      expect(isWin(s, 1.5)).toBe(true);
      expect(isWin(s, -1.5)).toBe(false);
      expect(isWin(s, 0)).toBe(false);
    }
  });

  it('exhaustion (évitement) : gagné si relPerf < 0 — logique inversée', () => {
    expect(isWin('exhaustion', -1.5)).toBe(true);
    expect(isWin('exhaustion', 1.5)).toBe(false);
    expect(isWin('exhaustion', 0)).toBe(false);
  });
});

describe('computeSignalStats', () => {
  it('retourne toujours les 4 signaux, même sans données', () => {
    const stats = computeSignalStats([]);
    expect(stats.map(s => s.signal)).toEqual(SIGNAL_KINDS);
    for (const s of stats) {
      expect(s.total).toBe(0);
      expect(s.avgScore).toBeNull();
      expect(s.j5).toEqual({ n: 0, avgRelPerf: null, winRate: null });
      expect(s.lowSample).toBe(true);
    }
  });

  it('sépare total (occurrences loggées) et n (perfs disponibles)', () => {
    const stats = computeSignalStats([
      row('dip', 60, { j5: 2.0 }),
      row('dip', 70), // backfill pas encore passé → rel_perf NULL
    ]);
    const dip = stats.find(s => s.signal === 'dip')!;
    expect(dip.total).toBe(2);
    expect(dip.j5.n).toBe(1);
    expect(dip.j10.n).toBe(0);
  });

  it('winRate et avgRelPerf par horizon', () => {
    const stats = computeSignalStats([
      row('dip', 60, { j5: 2.0, j10: -1.0 }),
      row('dip', 50, { j5: -1.0, j10: -3.0 }),
      row('dip', 70, { j5: 3.5 }),
    ]);
    const dip = stats.find(s => s.signal === 'dip')!;
    expect(dip.j5.n).toBe(3);
    expect(dip.j5.winRate).toBeCloseTo(2 / 3, 10);
    expect(dip.j5.avgRelPerf).toBeCloseTo((2.0 - 1.0 + 3.5) / 3, 10);
    expect(dip.j10.n).toBe(2);
    expect(dip.j10.winRate).toBe(0);
    expect(dip.j10.avgRelPerf).toBeCloseTo(-2.0, 10);
  });

  it('winRate d exhaustion inversé : sous-performance = réussite', () => {
    const stats = computeSignalStats([
      row('exhaustion', 80, { j5: -2.0 }), // bonne détection
      row('exhaustion', 75, { j5: -0.5 }), // bonne détection
      row('exhaustion', 85, { j5: 1.0 }),  // raté (a continué de monter)
    ]);
    const ex = stats.find(s => s.signal === 'exhaustion')!;
    expect(ex.j5.winRate).toBeCloseTo(2 / 3, 10);
    // avgRelPerf reste la moyenne brute, pas inversée
    expect(ex.j5.avgRelPerf).toBeCloseTo((-2.0 - 0.5 + 1.0) / 3, 10);
  });

  it('les signaux ne se contaminent pas entre eux', () => {
    const stats = computeSignalStats([
      row('dip', 60, { j5: 5.0 }),
      row('reversal', 40, { j5: -5.0 }),
    ]);
    expect(stats.find(s => s.signal === 'dip')!.j5.avgRelPerf).toBe(5.0);
    expect(stats.find(s => s.signal === 'reversal')!.j5.avgRelPerf).toBe(-5.0);
    expect(stats.find(s => s.signal === 'accelerating')!.total).toBe(0);
  });

  it('avgScore arrondi à l entier', () => {
    const stats = computeSignalStats([row('dip', 60), row('dip', 65)]);
    expect(stats.find(s => s.signal === 'dip')!.avgScore).toBe(63); // 62.5 → round
  });

  it(`lowSample bascule à ${LOW_SAMPLE_THRESHOLD} occurrences (perfs remplies ou non)`, () => {
    const nine = computeSignalStats(
      Array.from({ length: LOW_SAMPLE_THRESHOLD - 1 }, () => row('dip', 60)),
    );
    expect(nine.find(s => s.signal === 'dip')!.lowSample).toBe(true);

    const ten = computeSignalStats(
      Array.from({ length: LOW_SAMPLE_THRESHOLD }, () => row('dip', 60)),
    );
    expect(ten.find(s => s.signal === 'dip')!.lowSample).toBe(false);
  });

  it('ignore les signaux inconnus (ex. futur signal_change loggé par erreur)', () => {
    const stats = computeSignalStats([row('signal_change', 50, { j5: 1 })]);
    for (const s of stats) expect(s.total).toBe(0);
  });
});
