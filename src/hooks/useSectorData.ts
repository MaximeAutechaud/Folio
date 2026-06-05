import { useQuery } from '@tanstack/react-query';
import { fetchYahooHistory } from '../lib/api/yahoo';
import { SECTORS, type SectorDef } from '../lib/sectors';
import { calcRsi } from '../lib/indicators';

export interface SectorPerf {
  sector: SectorDef;
  currentPrice: number | null;
  etfPerf: number | null;
  relPerf: number | null;
  relPerf1W: number | null;
  relPerf1M: number | null;
  relPerf3M: number | null;
  drawdown3M: number | null;
  ma50: number | null;
  ma50Above: boolean | null;
  momentum: 'accelerating' | 'neutral' | 'decelerating';
  rsi: number | null;
  history: { time: number; value: number }[];
}

export interface HoldingPerf {
  ticker: string;
  name: string;
  perf: number | null;
  relPerf: number | null;
  currentPrice: number | null;
}

function calcPerf(history: { time: number; value: number }[]): number | null {
  if (history.length < 2) return null;
  const start = history[0].value;
  const end = history[history.length - 1].value;
  if (!start) return null;
  return ((end - start) / start) * 100;
}

export function useSectorPerfs(period: '1W' | '1M' | '3M') {
  return useQuery<SectorPerf[]>({
    queryKey: ['sector-perfs', period],
    queryFn: async () => {
      const allTickers = ['SPY', ...SECTORS.map(s => s.etf)];

      // Always fetch all three periods: 1W/1M for RS slope, 3M for RSI + drawdown
      const [hists1W, hists1M, hists3M] = await Promise.all([
        Promise.all(allTickers.map(t => fetchYahooHistory(t, '1W'))),
        Promise.all(allTickers.map(t => fetchYahooHistory(t, '1M'))),
        Promise.all(allTickers.map(t => fetchYahooHistory(t, '3M'))),
      ]);

      const periodHist = period === '1W' ? hists1W : period === '1M' ? hists1M : hists3M;

      const spy1W = calcPerf(hists1W[0]);
      const spy1M = calcPerf(hists1M[0]);
      const spy3M = calcPerf(hists3M[0]);
      const spyPeriodPerf = calcPerf(periodHist[0]);
      const periodWeeks = period === '1W' ? 1 : period === '1M' ? 4 : 13;

      return SECTORS.map((sector, i) => {
        const idx = i + 1;
        const hist = periodHist[idx];

        const etfPeriodPerf = calcPerf(hist);
        const relPeriodPerf =
          etfPeriodPerf != null && spyPeriodPerf != null
            ? etfPeriodPerf - spyPeriodPerf
            : null;

        const etf1W = calcPerf(hists1W[idx]);
        const etf1M = calcPerf(hists1M[idx]);
        const etf3M = calcPerf(hists3M[idx]);

        const relPerf1W = etf1W != null && spy1W != null ? etf1W - spy1W : null;
        const relPerf1M = etf1M != null && spy1M != null ? etf1M - spy1M : null;
        const relPerf3M = etf3M != null && spy3M != null ? etf3M - spy3M : null;

        // Momentum: this week's RS vs avg weekly RS of the display period
        const avgWeeklyRelPerf = relPeriodPerf != null ? relPeriodPerf / periodWeeks : null;
        let momentum: SectorPerf['momentum'] = 'neutral';
        if (relPerf1W != null && avgWeeklyRelPerf != null) {
          if (relPerf1W > avgWeeklyRelPerf + 0.3) momentum = 'accelerating';
          else if (relPerf1W < avgWeeklyRelPerf - 0.3) momentum = 'decelerating';
        }

        // RSI always from 3M daily data
        const rsiPrices = hists3M[idx]?.map(p => p.value) ?? [];
        const rsi = calcRsi(rsiPrices);

        // Drawdown from 3M high (stable reference for scoring)
        const prices3M = hists3M[idx] ?? [];
        const high3M = prices3M.length ? Math.max(...prices3M.map(p => p.value)) : null;
        const current3M = prices3M.length ? prices3M[prices3M.length - 1].value : null;
        const drawdown3M =
          high3M && current3M && high3M > 0
            ? ((current3M - high3M) / high3M) * 100
            : null;

        // 50-day MA from 3M daily data (~63 bars available)
        const ma50Bars = prices3M.length >= 50 ? prices3M.slice(-50) : prices3M;
        const ma50 = ma50Bars.length >= 20
          ? ma50Bars.reduce((s, p) => s + p.value, 0) / ma50Bars.length
          : null;
        const ma50Above = ma50 != null && current3M != null ? current3M > ma50 : null;

        return {
          sector,
          currentPrice: hist[hist.length - 1]?.value ?? null,
          etfPerf: etfPeriodPerf,
          relPerf: relPeriodPerf,
          relPerf1W,
          relPerf1M,
          relPerf3M,
          drawdown3M,
          ma50,
          ma50Above,
          momentum,
          rsi,
          history: hist,
        };
      }).sort((a, b) => (b.relPerf ?? -999) - (a.relPerf ?? -999));
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useSectorHoldings(sectorId: string | null, period: '1W' | '1M' | '3M' | '1Y') {
  const sector = sectorId ? SECTORS.find(s => s.id === sectorId) : null;

  return useQuery<HoldingPerf[]>({
    queryKey: ['sector-holdings', sectorId, period],
    enabled: !!sector,
    queryFn: async () => {
      const tickers = ['SPY', ...sector!.holdings.map(h => h.ticker)];
      const histories = await Promise.all(tickers.map(t => fetchYahooHistory(t, period)));
      const spyPerf = calcPerf(histories[0]);

      return sector!.holdings
        .map((h, i) => {
          const hist = histories[i + 1];
          const perf = calcPerf(hist);
          return {
            ...h,
            perf,
            relPerf: perf != null && spyPerf != null ? perf - spyPerf : null,
            currentPrice: hist[hist.length - 1]?.value ?? null,
          };
        })
        .sort((a, b) => (b.perf ?? -999) - (a.perf ?? -999));
    },
    staleTime: 5 * 60 * 1000,
  });
}
