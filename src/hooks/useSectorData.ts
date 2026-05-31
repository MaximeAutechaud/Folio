import { useQuery } from '@tanstack/react-query';
import { fetchYahooHistory } from '../lib/api/yahoo';
import { SECTORS, type SectorDef } from '../lib/sectors';
import { calcRsi } from '../lib/indicators';

export interface SectorPerf {
  sector: SectorDef;
  currentPrice: number | null;
  etfPerf: number | null;
  relPerf: number | null;
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
      const needWeekly = period !== '1W';
      const need3M = period !== '3M';

      const [periodHistories, weeklyHistories, rsiHistories] = await Promise.all([
        Promise.all(allTickers.map(t => fetchYahooHistory(t, period))),
        needWeekly
          ? Promise.all(allTickers.map(t => fetchYahooHistory(t, '1W')))
          : Promise.resolve([] as { time: number; value: number }[][]),
        need3M
          ? Promise.all(allTickers.map(t => fetchYahooHistory(t, '3M')))
          : Promise.resolve([] as { time: number; value: number }[][]),
      ]);

      const resolvedWeekly = needWeekly ? weeklyHistories : periodHistories;
      const resolvedRsi    = need3M    ? rsiHistories    : periodHistories;

      const spyPeriodPerf = calcPerf(periodHistories[0]);
      const spyWeekPerf = calcPerf(resolvedWeekly[0]);
      const periodWeeks = period === '1W' ? 1 : period === '1M' ? 4 : 13;

      return SECTORS.map((sector, i) => {
        const idx = i + 1;
        const hist = periodHistories[idx];
        const etfPeriodPerf = calcPerf(hist);
        const etfWeekPerf = calcPerf(resolvedWeekly[idx]);

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

        const rsiPrices = resolvedRsi[idx]?.map(p => p.value) ?? [];
        const rsi = calcRsi(rsiPrices);

        return {
          sector,
          currentPrice: hist[hist.length - 1]?.value ?? null,
          etfPerf: etfPeriodPerf,
          relPerf: relPeriodPerf,
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
