import { useQuery } from '@tanstack/react-query';
import { fetchYahooHistory } from '../lib/api/yahoo';
import type { Regime } from './useMacroScore';

export interface MacroScorePoint {
  time: number;
  score: number;
  regime: Regime;
}

// ── Helpers (mirrors useMacroScore) ──────────────────────────────────────────

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function norm(x: number, low: number, high: number): number {
  return clamp01((x - low) / (high - low));
}

// ── Tickers ───────────────────────────────────────────────────────────────────

const TICKERS = ['^VIX', 'DX-Y.NYB', '^TNX', '^IRX', 'HYG', 'GLD', 'HG=F', 'SPY', 'IWM'];

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMacroScoreHistory() {
  return useQuery<MacroScorePoint[]>({
    queryKey: ['macro-score-history'],
    queryFn: async () => {
      const histories = await Promise.all(TICKERS.map(t => fetchYahooHistory(t, '2Y')));

      const hist: Record<string, { time: number; value: number }[]> = {};
      TICKERS.forEach((t, i) => { hist[t] = histories[i]; });

      // Reference timeline: TNX (most complete for US rates)
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

      const W = { vix: 0.25, curve: 0.20, hyg: 0.15, iwm: 0.15, dxy: 0.10, copper: 0.10, gold: 0.05 };

      const points: MacroScorePoint[] = [];

      // Start at index 4 — need 4-week lookback for 1M perf calculation
      for (let i = 4; i < ref.length; i++) {
        const vix    = get('^VIX',    i);
        const tnx    = get('^TNX',    i);
        const irx    = get('^IRX',    i);
        const hyg1M  = perf(get('HYG',      i), get('HYG',      i - 4));
        const gld1M  = perf(get('GLD',      i), get('GLD',      i - 4));
        const cu1M   = perf(get('HG=F',     i), get('HG=F',     i - 4));
        const dxy1M  = perf(get('DX-Y.NYB', i), get('DX-Y.NYB', i - 4));
        const spy1M  = perf(get('SPY',      i), get('SPY',      i - 4));
        const iwm1M  = perf(get('IWM',      i), get('IWM',      i - 4));

        const yieldCurve = tnx != null && irx != null ? tnx - irx : null;
        const iwmVsSpy   = iwm1M != null && spy1M != null ? iwm1M - spy1M : null;

        const vixScore    = vix        != null ? norm(vix,        35, 15) * 100 : 50;
        const curveScore  = yieldCurve != null ? norm(yieldCurve, -1,  1) * 100 : 50;
        const hygScore    = hyg1M      != null ? norm(hyg1M,      -3,  3) * 100 : 50;
        const gldScore    = gld1M      != null ? norm(gld1M,       5, -3) * 100 : 50;
        const copperScore = cu1M       != null ? norm(cu1M,       -5,  5) * 100 : 50;
        const iwmScore    = iwmVsSpy   != null ? norm(iwmVsSpy,   -3,  3) * 100 : 50;
        const dxyScore    = dxy1M      != null ? norm(dxy1M,       3, -3) * 100 : 50;

        const score = Math.round(
          vixScore    * W.vix    +
          curveScore  * W.curve  +
          hygScore    * W.hyg    +
          iwmScore    * W.iwm    +
          dxyScore    * W.dxy    +
          copperScore * W.copper +
          gldScore    * W.gold
        );

        const regime: Regime =
          score >= 75 ? 'risk-on'     :
          score >= 55 ? 'favorable'   :
          score >= 40 ? 'neutral'     :
          score >= 25 ? 'unfavorable' :
          'risk-off';

        points.push({ time: ref[i].time, score, regime });
      }

      return points;
    },
    staleTime: 60 * 60 * 1000,  // 1h — données hebdo, peu volatiles
    refetchOnWindowFocus: false,
  });
}
