import { useQuery } from '@tanstack/react-query';
import { fetchNarratives, fetchAllNarrativeTickers } from '../lib/db';
import { fetchYahooHistory } from '../lib/api/yahoo';
import type { Narrative, NarrativeTicker } from '../types';

export type NarrativeMomentum = 'accelerating' | 'neutral' | 'decelerating';

export interface NarrativePerf {
  narrative: Narrative;
  tickers: NarrativeTicker[];
  basketPerf: number | null;
  relPerf: number | null;
  momentum: NarrativeMomentum;
  rsTrend: [number | null, number | null, number | null]; // [3M, 1M, 1W] vs SPY
  source: { type: 'etf'; label: string } | { type: 'basket'; count: number };
  lowConfidence: boolean;
}

type Point = { time: number; value: number };

function calcPerf(history: Point[]): number | null {
  if (history.length < 2) return null;
  const start = history[0].value;
  const end = history[history.length - 1].value;
  if (!start) return null;
  return ((end - start) / start) * 100;
}

function sliceByDays(history: Point[], daysBack: number): Point[] {
  const cutoff = Date.now() / 1000 - daysBack * 86400;
  const idx = history.findIndex(p => p.time >= cutoff);
  if (idx <= 0) return history;
  return history.slice(idx);
}

function calcBasketPerf(
  tickerHistories: Point[][],
  daysBack?: number
): number | null {
  const perfs = tickerHistories
    .map(h => calcPerf(daysBack ? sliceByDays(h, daysBack) : h))
    .filter((p): p is number => p != null);
  if (perfs.length === 0) return null;
  return perfs.reduce((s, p) => s + p, 0) / perfs.length;
}

function computePerf(
  narrative: Narrative,
  tickers: NarrativeTicker[],
  historyMap: Record<string, Point[]>,
  spyHistory: Point[],
  period: '1W' | '1M' | '3M'
): NarrativePerf {
  const daysMap = { '1W': 7, '1M': 30, '3M': 91 };
  const periodWeeks = period === '1W' ? 1 : period === '1M' ? 4 : 13;
  const daysBack = daysMap[period];

  const spyPerf = calcPerf(sliceByDays(spyHistory, daysBack));
  const spyWeekPerf = calcPerf(sliceByDays(spyHistory, 7));

  let basketPeriodPerf: number | null = null;
  let basketWeekPerf: number | null = null;
  let source: NarrativePerf['source'];

  if (narrative.ref_etf) {
    const etfHist = historyMap[narrative.ref_etf] ?? [];
    basketPeriodPerf = calcPerf(sliceByDays(etfHist, daysBack));
    basketWeekPerf   = calcPerf(sliceByDays(etfHist, 7));
    source = { type: 'etf', label: narrative.ref_etf };
  } else {
    const tickerHists = tickers
      .map(t => historyMap[t.ticker])
      .filter((h): h is Point[] => !!h && h.length >= 2);
    basketPeriodPerf = calcBasketPerf(tickerHists, daysBack);
    basketWeekPerf   = calcBasketPerf(tickerHists, 7);
    source = { type: 'basket', count: tickers.length };
  }

  const relPerf = basketPeriodPerf != null && spyPerf != null
    ? basketPeriodPerf - spyPerf
    : null;
  const relWeekPerf = basketWeekPerf != null && spyWeekPerf != null
    ? basketWeekPerf - spyWeekPerf
    : null;

  const avgWeeklyRelPerf = relPerf != null ? relPerf / periodWeeks : null;

  let momentum: NarrativeMomentum = 'neutral';
  if (relWeekPerf != null && avgWeeklyRelPerf != null) {
    if (relWeekPerf > avgWeeklyRelPerf + 0.3) momentum = 'accelerating';
    else if (relWeekPerf < avgWeeklyRelPerf - 0.3) momentum = 'decelerating';
  }

  // RS trend: relPerf vs SPY at 3 timeframes, always from 3M data
  function rsAt(days: number): number | null {
    let perf: number | null = null;
    if (narrative.ref_etf) {
      perf = calcPerf(sliceByDays(historyMap[narrative.ref_etf] ?? [], days));
    } else {
      const hists = tickers
        .map(t => historyMap[t.ticker])
        .filter((h): h is Point[] => !!h && h.length >= 2);
      perf = calcBasketPerf(hists, days);
    }
    const spy = calcPerf(sliceByDays(spyHistory, days));
    return perf != null && spy != null ? perf - spy : null;
  }

  const rsTrend: NarrativePerf['rsTrend'] = [rsAt(91), rsAt(30), rsAt(7)];

  const lowConfidence = source.type === 'basket' && source.count < 5;

  return {
    narrative,
    tickers,
    basketPerf: basketPeriodPerf,
    relPerf,
    momentum,
    rsTrend,
    source,
    lowConfidence,
  };
}

export function useNarrativePerfs(period: '1W' | '1M' | '3M') {
  return useQuery<NarrativePerf[]>({
    queryKey: ['narrative-perfs', period],
    queryFn: async () => {
      const [narratives, allTickers] = await Promise.all([
        fetchNarratives(true),
        fetchAllNarrativeTickers(),
      ]);

      if (narratives.length === 0) return [];

      const tickersByNarrative: Record<number, NarrativeTicker[]> = {};
      for (const t of allTickers) {
        if (!tickersByNarrative[t.narrative_id]) tickersByNarrative[t.narrative_id] = [];
        tickersByNarrative[t.narrative_id].push(t);
      }

      const tickersToFetch = new Set<string>(['SPY']);
      for (const n of narratives) {
        if (n.ref_etf) tickersToFetch.add(n.ref_etf);
        for (const t of tickersByNarrative[n.id] ?? []) tickersToFetch.add(t.ticker);
      }

      const uniqueTickers = Array.from(tickersToFetch);
      const histories = await Promise.all(
        uniqueTickers.map(t => fetchYahooHistory(t, '3M'))
      );
      const historyMap: Record<string, Point[]> = {};
      uniqueTickers.forEach((t, i) => { historyMap[t] = histories[i]; });

      const spyHistory = historyMap['SPY'] ?? [];

      return narratives
        .map(n => computePerf(n, tickersByNarrative[n.id] ?? [], historyMap, spyHistory, period))
        .sort((a, b) => (b.relPerf ?? -999) - (a.relPerf ?? -999));
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

// Exported for use in the drawer chart
export function computeBasketHistory(
  tickerHistories: Point[][]
): Point[] {
  const timeMap = new Map<number, number[]>();
  for (const hist of tickerHistories) {
    if (hist.length === 0) continue;
    const t0 = hist[0].value;
    if (!t0) continue;
    for (const p of hist) {
      if (!timeMap.has(p.time)) timeMap.set(p.time, []);
      timeMap.get(p.time)!.push((p.value / t0) * 100);
    }
  }
  return Array.from(timeMap.entries())
    .map(([time, vals]) => ({ time, value: vals.reduce((s, v) => s + v, 0) / vals.length }))
    .sort((a, b) => a.time - b.time);
}
