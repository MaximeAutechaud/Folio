import { useQuery } from '@tanstack/react-query';
import { fetchNarratives, fetchAllNarrativeTickers } from '../lib/db';
import { fetchYahooHistory } from '../lib/api/yahoo';
import { SECTORS } from '../lib/sectors';
import { calcRsi } from '../lib/indicators';
import { sliceByDays, calcPerf, type Point } from './useSectorData';
import type { Narrative, NarrativeTicker } from '../types';

// Pools de candidats : les narratives SANS ref_etf, rattachées à un secteur.
// On ne score plus le panier (bruit statistique, non investissable) — chaque
// ticker est évalué individuellement contre l'ETF du secteur : « le secteur
// donne un signal d'entrée, j'achète quoi concrètement ? ». Colonnes fixes
// (1M + RSI 3M daily), indépendantes du sélecteur de période du drawer.
export interface PoolTickerRow {
  ticker: string;
  name: string;
  perf1M: number | null;
  relPerf1M: number | null; // vs l'ETF du secteur parent
  rsi: number | null;       // RSI 14 daily sur 3M — même convention que le reste de l'app
  currentPrice: number | null;
}

export interface NarrativePool {
  narrative: Narrative;
  rows: PoolTickerRow[];
}

export function useNarrativePools(sectorId: string | null) {
  const sector = sectorId ? SECTORS.find((s) => s.id === sectorId) : null;

  return useQuery<NarrativePool[]>({
    queryKey: ['narrative-pools', sectorId],
    enabled: !!sector,
    queryFn: async () => {
      const [narratives, allTickers] = await Promise.all([
        fetchNarratives(true),
        fetchAllNarrativeTickers(),
      ]);
      const pools = narratives.filter((n) => !n.ref_etf && n.parent_sector === sectorId);
      if (pools.length === 0) return [];

      const tickersByNarrative: Record<number, NarrativeTicker[]> = {};
      for (const t of allTickers) {
        (tickersByNarrative[t.narrative_id] ??= []).push(t);
      }

      const uniqueTickers = [
        ...new Set(pools.flatMap((p) => (tickersByNarrative[p.id] ?? []).map((t) => t.ticker))),
      ];
      const histories = await Promise.all(
        [sector!.etf, ...uniqueTickers].map((t) => fetchYahooHistory(t, '3M'))
      );
      const histByTicker: Record<string, Point[]> = {};
      uniqueTickers.forEach((t, i) => { histByTicker[t] = histories[i + 1]; });

      const etfPerf1M = calcPerf(sliceByDays(histories[0], 31));

      return pools.map((narrative) => ({
        narrative,
        rows: (tickersByNarrative[narrative.id] ?? [])
          .map((t) => {
            const hist = histByTicker[t.ticker] ?? [];
            const perf1M = calcPerf(sliceByDays(hist, 31));
            return {
              ticker: t.ticker,
              name: t.name,
              perf1M,
              relPerf1M: perf1M != null && etfPerf1M != null ? perf1M - etfPerf1M : null,
              rsi: calcRsi(hist.map((p) => p.value)),
              currentPrice: hist[hist.length - 1]?.value ?? null,
            };
          })
          .sort((a, b) => (b.relPerf1M ?? -999) - (a.relPerf1M ?? -999)),
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}
