import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchYahooHistory } from '../lib/api/yahoo';
import { SECTORS, type SectorDef } from '../lib/sectors';
import { calcRsi } from '../lib/indicators';

// Métriques d'un ETF quelconque (secteur ou narrative-ETF) — calculées depuis
// un historique 6M daily par computeEtfMetrics. SectorPerf = EtfMetrics + secteur.
export interface EtfMetrics {
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

export interface SectorPerf extends EtfMetrics {
  sector: SectorDef;
}

export interface HoldingPerf {
  ticker: string;
  name: string;
  perf: number | null;
  relPerf: number | null;
  currentPrice: number | null;
}

export type Point = { time: number; value: number };

// SPY et RSP en tête, puis les ETF sectoriels dans l'ordre de SECTORS.
// Exporté pour que le backfill de signaux (Phase 3) tape le même cache ['sector-raw'].
export const SECTOR_TICKERS = ['SPY', 'RSP', ...SECTORS.map(s => s.etf)];
const STALE = 5 * 60 * 1000;

/** Période affichée → nombre de séances. Partagé par les hooks secteurs et narratives. */
export const PERIOD_BARS = { '1W': 5, '1M': 21, '3M': 63 } as const;

/**
 * Fenêtres du moteur de signaux, **en séances** et non en jours calendaires.
 *
 * Les anciennes bornes 7/31/93 jours contenaient 4 à 6, 20 à 23 et 62 à 66
 * séances selon les jours fériés et la position dans la semaine. Un moteur qui
 * compare une perf à un seuil fixe voyait donc son échantillon varier d'environ
 * ±10 % d'une séance à l'autre, sans qu'aucun prix ne bouge. En barres, la
 * fenêtre est la même partout dans l'historique.
 */
export const BARS = { w1: 5, m1: 21, m3: 63, m6: 126 } as const;

/**
 * Les `bars` dernières séances, soit `bars + 1` bougies — il faut deux bornes
 * pour mesurer une variation, donc n+1 bougies pour n séances.
 *
 * Contrairement à `sliceByDays` qu'elle remplace, cette fonction n'a pas de
 * `nowSec` : elle part de la fin de la série. C'est à l'appelant de fournir une
 * série close à la date visée (`truncateBars`), ce qui supprime le doublon
 * fragile où la troncature et le paramètre `nowSec` devaient s'accorder.
 */
export function sliceByBars(history: Point[], bars: number): Point[] {
  const n = bars + 1;
  return history.length <= n ? history : history.slice(history.length - n);
}

export function calcPerf(history: Point[]): number | null {
  if (history.length < 2) return null;
  const start = history[0].value;
  if (!start) return null;
  return ((history[history.length - 1].value - start) / start) * 100;
}

// Perfs d'un benchmark sur les fenêtres standard (période sélectionnée + 1W/1M/3M).
export interface BenchWindows {
  period: number | null;
  w1: number | null;
  m1: number | null;
  m3: number | null;
}

export function calcBenchWindows(raw: Point[], periodBars: number): BenchWindows {
  return {
    period: calcPerf(sliceByBars(raw, periodBars)),
    w1: calcPerf(sliceByBars(raw, BARS.w1)),
    m1: calcPerf(sliceByBars(raw, BARS.m1)),
    m3: calcPerf(sliceByBars(raw, BARS.m3)),
  };
}

// Toutes les métriques d'un ETF depuis son historique 6M daily, relatives à
// SPY (affichage/tri) et RSP (score d'opportunité). Partagé entre les 13
// secteurs et les narratives-ETF (second anneau de l'entonnoir).
export function computeEtfMetrics(
  raw: Point[],
  spy: BenchWindows,
  rsp: BenchWindows,
  periodBars: number,
): EtfMetrics {
  const hist = sliceByBars(raw, periodBars);

  const etfPeriodPerf = calcPerf(hist);
  const relPeriodPerf =
    etfPeriodPerf != null && spy.period != null ? etfPeriodPerf - spy.period : null;

  const etf1W = calcPerf(sliceByBars(raw, BARS.w1));
  const etf1M = calcPerf(sliceByBars(raw, BARS.m1));
  const etf3M = calcPerf(sliceByBars(raw, BARS.m3));

  // Display/sort: relative to SPY (cap-weight)
  const relPerf1W = etf1W != null && spy.w1 != null ? etf1W - spy.w1 : null;
  const relPerf1M = etf1M != null && spy.m1 != null ? etf1M - spy.m1 : null;
  const relPerf3M = etf3M != null && spy.m3 != null ? etf3M - spy.m3 : null;

  // Scoring: relative to RSP (equal-weight)
  const relPerf1W_ew = etf1W != null && rsp.w1 != null ? etf1W - rsp.w1 : null;
  const relPerf1M_ew = etf1M != null && rsp.m1 != null ? etf1M - rsp.m1 : null;
  const relPerf3M_ew = etf3M != null && rsp.m3 != null ? etf3M - rsp.m3 : null;

  // Momentum reflects the sector's *current* acceleration, independent of
  // the selected view period: this week's relative pace vs the trailing
  // month's average weekly pace (= scoring.ts shortAccel). Deriving it from
  // the selected period made the 1W view degenerate — relPeriodPerf == relPerf1W
  // and periodWeeks == 1, so it compared relPerf1W against itself → always neutral.
  const avgWeeklyRelPerf = relPerf1M != null ? relPerf1M / 4 : null;
  let momentum: EtfMetrics['momentum'] = 'neutral';
  if (relPerf1W != null && avgWeeklyRelPerf != null) {
    if (relPerf1W > avgWeeklyRelPerf + 0.3) momentum = 'accelerating';
    else if (relPerf1W < avgWeeklyRelPerf - 0.3) momentum = 'decelerating';
  }

  // RSI sur les 63 dernières séances (~3M)
  const raw3M = sliceByBars(raw, BARS.m3);
  const rsi = calcRsi(raw3M.map(p => p.value));

  // `high6M` est désormais borné explicitement aux 126 dernières séances. Avant,
  // il prenait le plus haut de *toute la série reçue* : correct en direct (la
  // série fetchée fait 6M) mais faux dès qu'on rejoue une date passée sur un
  // historique long, où « plus haut 6 mois » devenait « plus haut 16 ans ». La
  // justesse ne dépend donc plus d'une troncature en amont — celle-ci ne sert
  // plus qu'à la performance.
  const raw6M = sliceByBars(raw, BARS.m6);
  const current = raw.length ? raw[raw.length - 1].value : null;
  const high3M  = raw3M.length ? Math.max(...raw3M.map(p => p.value)) : null;
  const high6M  = raw6M.length ? Math.max(...raw6M.map(p => p.value)) : null;
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
      const periodBars = PERIOD_BARS[period];

      // Two benchmarks: SPY (cap-weight) drives the displayed relPerf + sort,
      // RSP (equal-weight) drives the opportunity score.
      const spyBench = calcBenchWindows(histsRaw[0], periodBars);
      const rspBench = calcBenchWindows(histsRaw[1], periodBars);

      return SECTORS.map((sector, i) => ({
        sector,
        ...computeEtfMetrics(histsRaw[i + 2] ?? [], spyBench, rspBench, periodBars),
      })).sort((a, b) => (b.relPerf ?? -999) - (a.relPerf ?? -999));
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
