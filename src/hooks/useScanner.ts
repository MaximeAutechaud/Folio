import { useQuery } from '@tanstack/react-query';
import { fetchAllPriceBars, fetchScannerUniverse } from '../lib/db';
import { toBars } from '../lib/priceCache';
import { MARKET_TICKER, sectorEtf } from '../lib/universe';
import {
  type Bar,
} from '../lib/scanner';
import {
  runAccelerationPoc,
  type AccelerationCandidate,
  type AccelerationCluster,
} from '../lib/scannerAcceleration';

export interface ScanMember extends AccelerationCandidate {
  sectorId: string | null;
}

export interface ScanCluster extends AccelerationCluster {
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
export function useScanner() {
  return useQuery<ScanResult>({
    queryKey: ['scanner', 'acceleration-poc-v1'],
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

      const { clusters: raw, candidates, dropped } = runAccelerationPoc(
        series,
        t => isControl.has(t),
        {
          sectorOf: t => sectorById.get(t) ?? null,
          etfOf: sectorEtf,
          marketTicker: MARKET_TICKER,
        },
      );

      const byTicker = new Map(candidates.map(c => [c.ticker, c]));
      const clusters: ScanCluster[] = raw.map(c => ({
        ...c,
        members: c.tickers
          .map(t => ({ ...byTicker.get(t)!, sectorId: sectorById.get(t) ?? null }))
          .sort((a, b) => b.accelerationPercentile - a.accelerationPercentile),
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
        scanned: Object.keys(series).filter(t => !isControl.has(t)).length,
        asOf,
      };
    },
    staleTime: 60_000,
  });
}
