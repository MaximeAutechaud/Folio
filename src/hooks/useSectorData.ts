import { useQuery } from '@tanstack/react-query';
import { fetchYahooHistory } from '../lib/api/yahoo';
import { SECTORS, type SectorDef } from '../lib/sectors';

export interface SectorPerf {
  sector: SectorDef;
  currentPrice: number | null;
  etfPerf: number | null;
  relPerf: number | null;
  momentum: 'accelerating' | 'neutral' | 'decelerating';
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
      const needWeekly = period !== '1W';

      const periodHistories = await Promise.all(
        allTickers.map(t => fetchYahooHistory(t, period))
      );

      const weeklyHistories: { time: number; value: number }[][] = needWeekly
        ? await Promise.all(allTickers.map(t => fetchYahooHistory(t, '1W')))
        : periodHistories;

      const spyPeriodPerf = calcPerf(periodHistories[0]);
      const spyWeekPerf = calcPerf(weeklyHistories[0]);
      const periodWeeks = period === '1W' ? 1 : period === '1M' ? 4 : 13;

      return SECTORS.map((sector, i) => {
        const idx = i + 1;
        const hist = periodHistories[idx];
        const etfPeriodPerf = calcPerf(hist);
        const etfWeekPerf = calcPerf(weeklyHistories[idx]);

        const relPeriodPerf =
          etfPeriodPerf != null && spyPeriodPerf != null
            ? etfPeriodPerf - spyPeriodPerf
            : null;
        const relWeekPerf =
          etfWeekPerf != null && spyWeekPerf != null
            ? etfWeekPerf - spyWeekPerf
            : null;

        const avgWeeklyRelPerf =
          relPeriodPerf != null ? relPeriodPerf / periodWeeks : null;

        let momentum: SectorPerf['momentum'] = 'neutral';
        if (relWeekPerf != null && avgWeeklyRelPerf != null) {
          if (relWeekPerf > avgWeeklyRelPerf + 0.3) momentum = 'accelerating';
          else if (relWeekPerf < avgWeeklyRelPerf - 0.3) momentum = 'decelerating';
        }

        return {
          sector,
          currentPrice: hist[hist.length - 1]?.value ?? null,
          etfPerf: etfPeriodPerf,
          relPerf: relPeriodPerf,
          momentum,
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
