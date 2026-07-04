import type { SignalLogRow } from '../types';

// Pur & testable : agrège les logs de signaux en taux de réussite / perf moyenne
// par type de signal et par horizon (J+5 / J+10 / J+20).

export type SignalKind = 'dip' | 'reversal' | 'accelerating' | 'exhaustion';

export const SIGNAL_KINDS: SignalKind[] = ['dip', 'reversal', 'accelerating', 'exhaustion'];

export const SIGNAL_META: Record<SignalKind, { label: string; bullish: boolean; color: string }> = {
  dip:          { label: 'Dip',          bullish: true,  color: '#3fb950' },
  reversal:     { label: 'Reversal',     bullish: true,  color: '#58a6ff' },
  accelerating: { label: 'Accelerating', bullish: true,  color: '#a371f7' },
  // exhaustion = signal d'évitement : une bonne détection = sous-performance ensuite
  exhaustion:   { label: 'Exhaustion',   bullish: false, color: '#f0883e' },
};

// « Réussite » : pour les signaux haussiers, relPerf > 0 après coup. Pour
// exhaustion (signal d'évitement/allègement), la réussite = relPerf < 0.
export function isWin(signal: SignalKind, relPerf: number): boolean {
  return SIGNAL_META[signal].bullish ? relPerf > 0 : relPerf < 0;
}

export interface HorizonStat {
  n: number;                  // occurrences avec une perf disponible à cet horizon
  avgRelPerf: number | null;  // perf relative moyenne vs SPY
  winRate: number | null;     // fraction 0..1 (null si n === 0)
}

export interface SignalStat {
  signal: SignalKind;
  total: number;              // occurrences loggées (données forward ou non)
  avgScore: number | null;    // score d'opportunité moyen au moment du signal
  j5: HorizonStat;
  j10: HorizonStat;
  j20: HorizonStat;
  lowSample: boolean;         // total < LOW_SAMPLE_THRESHOLD
}

export const LOW_SAMPLE_THRESHOLD = 10;

function horizonStat(signal: SignalKind, perfs: (number | null)[]): HorizonStat {
  const vals = perfs.filter((p): p is number => p != null);
  if (vals.length === 0) return { n: 0, avgRelPerf: null, winRate: null };
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const wins = vals.filter(v => isWin(signal, v)).length;
  return { n: vals.length, avgRelPerf: avg, winRate: wins / vals.length };
}

export function computeSignalStats(rows: SignalLogRow[]): SignalStat[] {
  return SIGNAL_KINDS.map(signal => {
    const group = rows.filter(r => r.signal === signal);
    const scores = group.map(r => r.score).filter((s): s is number => s != null);
    return {
      signal,
      total: group.length,
      avgScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
      j5:  horizonStat(signal, group.map(r => r.rel_perf_j5)),
      j10: horizonStat(signal, group.map(r => r.rel_perf_j10)),
      j20: horizonStat(signal, group.map(r => r.rel_perf_j20)),
      lowSample: group.length < LOW_SAMPLE_THRESHOLD,
    };
  });
}
