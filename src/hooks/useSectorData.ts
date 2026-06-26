import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  // Equal-weight (RSP) relatives — fed to the opportunity score, immune to the
  // mega-cap base effect that inflates SPY-relative perf during tech selloffs.
  relPerf1W_ew: number | null;
  relPerf1M_ew: number | null;
  relPerf3M_ew: number | null;
  drawdown3M: number | null;
  drawdown6M: number | null;
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

type Point = { time: number; value: number };

const SECTOR_TICKERS = ['SPY', 'RSP', ...SECTORS.map(s => s.etf)];
const STALE = 5 * 60 * 1000;

function sliceByDays(history: Point[], daysBack: number): Point[] {
  const cutoff = Date.now() / 1000 - daysBack * 86400;
  const idx = history.findIndex(p => p.time >= cutoff);
  return idx <= 0 ? history : history.slice(idx);
}

function calcPerf(history: Point[]): number | null {
  if (history.length < 2) return null;
  const start = history[0].value;
  if (!start) return null;
  return ((history[history.length - 1].value - start) / start) * 100;
}

// Base query: always 6M daily, shared across all period variants.
// 6M provides the long high for the drawdown blend; the 1W/1M/3M windows are
// sliced from it, so period switching stays pure computation (no extra requests).
function useSectorRaw() {
  return useQuery<Point[][]>({
    queryKey: ['sector-raw'],
    queryFn: () => Promise.all(SECTOR_TICKERS.map(t => fetchYahooHistory(t, '6M'))),
    staleTime: STALE,
    refetchInterval: STALE,
  });
}

export function useSectorPerfs(period: '1W' | '1M' | '3M') {
  const queryClient = useQueryClient();

  return useQuery<SectorPerf[]>({
    queryKey: ['sector-perfs', period],
    queryFn: async () => {
      // Reuse cached 6M data — fires only if not already in cache
      const histsRaw = await queryClient.fetchQuery<Point[][]>({
        queryKey: ['sector-raw'],
        queryFn: () => Promise.all(SECTOR_TICKERS.map(t => fetchYahooHistory(t, '6M'))),
        staleTime: STALE,
      });

      // Base series is 6M; slice every window explicitly (3M is no longer "full").
      const DAYS = { '1W': 7, '1M': 31, '3M': 93 } as const;
      const daysBack = DAYS[period];
      const slice = (h: Point[]) => sliceByDays(h, daysBack);

      // Two benchmarks: SPY (cap-weight) drives the displayed relPerf + sort,
      // RSP (equal-weight) drives the opportunity score.
      const spyRaw = histsRaw[0];
      const rspRaw = histsRaw[1];

      const spyPerf   = calcPerf(slice(spyRaw));
      const spy1WPerf = calcPerf(sliceByDays(spyRaw, 7));
      const spy1MPerf = calcPerf(sliceByDays(spyRaw, 31));
      const spy3MPerf = calcPerf(sliceByDays(spyRaw, 93));

      const rsp1WPerf = calcPerf(sliceByDays(rspRaw, 7));
      const rsp1MPerf = calcPerf(sliceByDays(rspRaw, 31));
      const rsp3MPerf = calcPerf(sliceByDays(rspRaw, 93));

      return SECTORS.map((sector, i) => {
        const raw   = histsRaw[i + 2] ?? [];
        const hist  = slice(raw);

        const etfPeriodPerf = calcPerf(hist);
        const relPeriodPerf =
          etfPeriodPerf != null && spyPerf != null ? etfPeriodPerf - spyPerf : null;

        const etf1W = calcPerf(sliceByDays(raw, 7));
        const etf1M = calcPerf(sliceByDays(raw, 31));
        const etf3M = calcPerf(sliceByDays(raw, 93));

        // Display/sort: relative to SPY (cap-weight)
        const relPerf1W = etf1W != null && spy1WPerf != null ? etf1W - spy1WPerf : null;
        const relPerf1M = etf1M != null && spy1MPerf != null ? etf1M - spy1MPerf : null;
        const relPerf3M = etf3M != null && spy3MPerf != null ? etf3M - spy3MPerf : null;

        // Scoring: relative to RSP (equal-weight)
        const relPerf1W_ew = etf1W != null && rsp1WPerf != null ? etf1W - rsp1WPerf : null;
        const relPerf1M_ew = etf1M != null && rsp1MPerf != null ? etf1M - rsp1MPerf : null;
        const relPerf3M_ew = etf3M != null && rsp3MPerf != null ? etf3M - rsp3MPerf : null;

        // Momentum reflects the sector's *current* acceleration, independent of
        // the selected view period: this week's relative pace vs the trailing
        // month's average weekly pace (= scoring.ts shortAccel). Deriving it from
        // the selected period made the 1W view degenerate — relPeriodPerf == relPerf1W
        // and periodWeeks == 1, so it compared relPerf1W against itself → always neutral.
        const avgWeeklyRelPerf = relPerf1M != null ? relPerf1M / 4 : null;
        let momentum: SectorPerf['momentum'] = 'neutral';
        if (relPerf1W != null && avgWeeklyRelPerf != null) {
          if (relPerf1W > avgWeeklyRelPerf + 0.3) momentum = 'accelerating';
          else if (relPerf1W < avgWeeklyRelPerf - 0.3) momentum = 'decelerating';
        }

        // RSI on the trailing 3M window (preserves prior behaviour now that raw is 6M)
        const raw3M = sliceByDays(raw, 93);
        const rsi = calcRsi(raw3M.map(p => p.value));

        const current = raw.length ? raw[raw.length - 1].value : null;
        const high3M  = raw3M.length ? Math.max(...raw3M.map(p => p.value)) : null;
        const high6M  = raw.length ? Math.max(...raw.map(p => p.value)) : null;
        const drawdown3M =
          high3M && current && high3M > 0 ? ((current - high3M) / high3M) * 100 : null;
        const drawdown6M =
          high6M && current && high6M > 0 ? ((current - high6M) / high6M) * 100 : null;

        const ma50Bars = raw.length >= 50 ? raw.slice(-50) : null;
        const ma50 = ma50Bars
          ? ma50Bars.reduce((s, p) => s + p.value, 0) / ma50Bars.length
          : null;
        const ma50Above = ma50 != null && current != null ? current > ma50 : null;

        return {
          sector,
          currentPrice: hist[hist.length - 1]?.value ?? null,
          etfPerf: etfPeriodPerf,
          relPerf: relPeriodPerf,
          relPerf1W,
          relPerf1M,
          relPerf3M,
          relPerf1W_ew,
          relPerf1M_ew,
          relPerf3M_ew,
          drawdown3M,
          drawdown6M,
          ma50,
          ma50Above,
          momentum,
          rsi,
          history: hist,
        };
      }).sort((a, b) => (b.relPerf ?? -999) - (a.relPerf ?? -999));
    },
    staleTime: STALE,
    refetchInterval: STALE,
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
    staleTime: STALE,
  });
}

// Exported for components that want to prefetch the raw data eagerly
export { useSectorRaw };
