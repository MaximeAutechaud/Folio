import { useQuery } from '@tanstack/react-query';
import { fetchAllPriceBars, fetchScannerUniverse } from '../lib/db';
import { toBars } from '../lib/priceCache';
import { MARKET_TICKER, sectorEtf } from '../lib/universe';
import {
  scanCandidates,
  buildClusterInputs,
  findClusters,
  DEFAULT_FILTER,
  DEFAULT_CLUSTER,
  type Bar,
  type Candidate,
  type Cluster,
  type CandidateFilter,
} from '../lib/scanner';

export interface ScanMember extends Candidate {
  sectorId: string | null;
}

export interface ScanCluster extends Cluster {
  members: ScanMember[];
}

export interface ScanResult {
  clusters: ScanCluster[];
  /** Diagnostic uniquement — jamais affiché comme liste actionnable. */
  candidateCount: number;
  /** Candidats écartés faute de benchmark exploitable. */
  droppedCount: number;
  /** Titres présents dans le cache, hors instruments de contrôle. */
  scanned: number;
  /** Date de la dernière bougie connue, pour situer le scan dans le temps. */
  asOf: string | null;
}

const EMPTY: ScanResult = {
  clusters: [], candidateCount: 0, droppedCount: 0, scanned: 0, asOf: null,
};

/**
 * Exécute le scan sur le cache de prix local.
 *
 * Aucune requête réseau : tout part de `price_bars`, alimenté par
 * `useUniverseSync`. Le scan est donc instantané et rejouable, ce qui compte —
 * on va vouloir bouger les seuils et revoir le résultat sans re-télécharger
 * 900 séries.
 */
export function useScanner(filter: CandidateFilter = DEFAULT_FILTER) {
  return useQuery<ScanResult>({
    queryKey: ['scanner', filter],
    queryFn: async () => {
      const [rows, universe] = await Promise.all([fetchAllPriceBars(), fetchScannerUniverse()]);
      if (universe.length === 0) return EMPTY;

      const sectorById = new Map(universe.map(u => [u.ticker, u.sector_id]));
      const isControl = new Set(
        universe.filter(u => u.source === 'control').map(u => u.ticker),
      );

      // Toutes les séries, contrôles compris — la résidualisation en a besoin.
      const series: Record<string, Bar[]> = {};
      for (const [ticker, r] of Object.entries(rows)) series[ticker] = toBars(r);

      // Les candidats, eux, excluent les instruments de contrôle : un ETF
      // sectoriel n'est pas une narrative naissante, c'est ce qu'on lui retire.
      const candidateSeries: Record<string, Bar[]> = {};
      for (const [ticker, bars] of Object.entries(series)) {
        if (!isControl.has(ticker)) candidateSeries[ticker] = bars;
      }

      const candidates = scanCandidates(candidateSeries, filter);
      const { inputs, dropped } = buildClusterInputs(candidates, series, {
        sectorOf: t => sectorById.get(t) ?? null,
        etfOf: sectorEtf,
        marketTicker: MARKET_TICKER,
      });

      const byTicker = new Map(candidates.map(c => [c.ticker, c]));
      const clusters: ScanCluster[] = findClusters(inputs, DEFAULT_CLUSTER).map(c => ({
        ...c,
        members: c.tickers
          .map(t => ({ ...byTicker.get(t)!, sectorId: sectorById.get(t) ?? null }))
          .sort((a, b) => b.z - a.z),
      }));

      const asOf = Object.values(rows)
        .map(r => r[r.length - 1]?.date)
        .filter(Boolean)
        .sort()
        .pop() ?? null;

      return {
        clusters,
        candidateCount: candidates.length,
        droppedCount: dropped.length,
        scanned: Object.keys(candidateSeries).length,
        asOf,
      };
    },
    staleTime: 60_000,
  });
}
