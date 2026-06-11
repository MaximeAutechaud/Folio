import { useQuery } from '@tanstack/react-query';
import { fetchYahooHistory } from '../lib/api/yahoo';
import { calcMacroScore, regimeFromScore } from '../lib/macroScore';
import type { Regime } from '../lib/macroScore';

export type { Regime };

export interface MacroScorePoint {
  time: number;
  score: number;
  regime: Regime;
}

const TICKERS = ['^VIX', 'DX-Y.NYB', '^TNX', '^IRX', 'HYG', 'GLD', 'HG=F', 'SPY', 'IWM'];

export function useMacroScoreHistory() {
  return useQuery<MacroScorePoint[]>({
    queryKey: ['macro-score-history'],
    queryFn: async () => {
      const histories = await Promise.all(TICKERS.map(t => fetchYahooHistory(t, '2Y')));

      const hist: Record<string, { time: number; value: number }[]> = {};
      TICKERS.forEach((t, i) => { hist[t] = histories[i]; });

      const ref = hist['^TNX'];
      if (!ref || ref.length < 5) return [];

      const get = (ticker: string, i: number): number | null => {
        const h = hist[ticker];
        if (!h || i < 0 || i >= h.length) return null;
        return h[i].value ?? null;
      };

      const perf = (curr: number | null, prev: number | null): number | null =>
        curr != null && prev != null && prev !== 0
          ? ((curr - prev) / prev) * 100
          : null;

      const points: MacroScorePoint[] = [];

      for (let i = 4; i < ref.length; i++) {
        const tnx   = get('^TNX', i);
        const irx   = get('^IRX', i);
        const spy1M = perf(get('SPY',      i), get('SPY',      i - 4));
        const iwm1M = perf(get('IWM',      i), get('IWM',      i - 4));

        const score = calcMacroScore({
          vix:        get('^VIX', i),
          yieldCurve: tnx != null && irx != null ? tnx - irx : null,
          hyg1M:      perf(get('HYG',      i), get('HYG',      i - 4)),
          gld1M:      perf(get('GLD',      i), get('GLD',      i - 4)),
          copper1M:   perf(get('HG=F',     i), get('HG=F',     i - 4)),
          dxy1M:      perf(get('DX-Y.NYB', i), get('DX-Y.NYB', i - 4)),
          iwmVsSpy:   iwm1M != null && spy1M != null ? iwm1M - spy1M : null,
        });

        points.push({ time: ref[i].time, score, regime: regimeFromScore(score) });
      }

      return points;
    },
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
