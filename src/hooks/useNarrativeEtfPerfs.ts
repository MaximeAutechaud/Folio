import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchNarratives, fetchAllNarrativeTickers } from '../lib/db';
import { fetchYahooHistory } from '../lib/api/yahoo';
import { SECTORS, type MacroProfile } from '../lib/sectors';
import { narrativeMacroProfile } from '../lib/scoring';
import {
  SECTOR_TICKERS,
  calcBenchWindows,
  computeEtfMetrics,
  sliceByDays,
  calcPerf,
  type EtfMetrics,
  type Point,
} from './useSectorData';
import type { Narrative, NarrativeTicker } from '../types';

// Second anneau de l'entonnoir : les narratives AVEC ref_etf, scorées avec
// exactement le même pipeline que les 13 secteurs (mêmes benchmarks SPY/RSP,
// mêmes bornes de score — le signal_log arbitrera leur fiabilité). La RS vs le
// secteur parent est une métrique d'affichage, pas une entrée du score.
export interface NarrativeEtfPerf extends EtfMetrics {
  narrative: Narrative;
  tickers: NarrativeTicker[];
  macroProfile: MacroProfile;
  // « Le thème tire-t-il son secteur ? » — ETF narrative vs ETF du parent_sector
  relPerfVsParent: number | null;   // fenêtre de la période sélectionnée
  relPerfVsParent1W: number | null;
  relPerfVsParent1M: number | null;
  relPerfVsParent3M: number | null;
}

const STALE = 5 * 60 * 1000;

export function useNarrativeEtfPerfs(period: '1W' | '1M' | '3M') {
  const queryClient = useQueryClient();

  return useQuery<NarrativeEtfPerf[]>({
    queryKey: ['narrative-etf-perfs', period],
    queryFn: async () => {
      const [narratives, allTickers] = await Promise.all([
        fetchNarratives(true),
        fetchAllNarrativeTickers(),
      ]);
      const etfNarratives = narratives.filter((n) => n.ref_etf);
      if (etfNarratives.length === 0) return [];

      const tickersByNarrative: Record<number, NarrativeTicker[]> = {};
      for (const t of allTickers) {
        (tickersByNarrative[t.narrative_id] ??= []).push(t);
      }

      // SPY, RSP et les 13 ETF sectoriels (pour la RS vs parent) sont déjà
      // dans le cache partagé ['sector-raw'] — zéro requête si les secteurs
      // ont été affichés récemment.
      const sectorRaw = await queryClient.fetchQuery<Point[][]>({
        queryKey: ['sector-raw'],
        queryFn: () => Promise.all(SECTOR_TICKERS.map((t) => fetchYahooHistory(t, '6M'))),
        staleTime: STALE,
      });

      const etfs = [...new Set(etfNarratives.map((n) => n.ref_etf!))].sort();
      const etfRaw = await queryClient.fetchQuery<Point[][]>({
        // La liste d'ETF fait partie de la clé : activer/désactiver une
        // narrative invalide naturellement le cache brut.
        queryKey: ['narrative-etf-raw', etfs.join(',')],
        queryFn: () => Promise.all(etfs.map((t) => fetchYahooHistory(t, '6M'))),
        staleTime: STALE,
      });
      const rawByEtf: Record<string, Point[]> = {};
      etfs.forEach((t, i) => { rawByEtf[t] = etfRaw[i]; });

      const DAYS = { '1W': 7, '1M': 31, '3M': 93 } as const;
      const daysBack = DAYS[period];
      const spyBench = calcBenchWindows(sectorRaw[0] ?? [], daysBack);
      const rspBench = calcBenchWindows(sectorRaw[1] ?? [], daysBack);

      const sectorRawById: Record<string, Point[]> = {};
      SECTORS.forEach((s, i) => { sectorRawById[s.id] = sectorRaw[i + 2] ?? []; });

      return etfNarratives
        .map((n) => {
          const raw = rawByEtf[n.ref_etf!] ?? [];
          const parent = n.parent_sector ? SECTORS.find((s) => s.id === n.parent_sector) : undefined;
          const parentRaw = (n.parent_sector && sectorRawById[n.parent_sector]) || [];

          const vsParent = (days: number): number | null => {
            const own = calcPerf(sliceByDays(raw, days));
            const par = calcPerf(sliceByDays(parentRaw, days));
            return own != null && par != null ? own - par : null;
          };

          return {
            ...computeEtfMetrics(raw, spyBench, rspBench, daysBack),
            narrative: n,
            tickers: tickersByNarrative[n.id] ?? [],
            macroProfile: narrativeMacroProfile(n.ref_etf!, parent?.macroProfile ?? 'neutral'),
            relPerfVsParent: vsParent(daysBack),
            relPerfVsParent1W: vsParent(7),
            relPerfVsParent1M: vsParent(31),
            relPerfVsParent3M: vsParent(93),
          };
        })
        .sort((a, b) => (b.relPerf ?? -999) - (a.relPerf ?? -999));
    },
    staleTime: STALE,
    refetchInterval: STALE,
  });
}
