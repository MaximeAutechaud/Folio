import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchYahooHistory, type Bar } from '../lib/api/yahoo';
import { SECTORS } from '../lib/sectors';
import { SECTOR_TICKERS } from './useSectorData';
import { relativeForward, peerRelPerf, forwardPath, PRIMARY_HORIZON } from '../lib/rebuildSignals';
import {
  fetchSignalLogsNeedingBackfill,
  updateSignalLogPerf,
  type SignalPerfPatch,
} from '../lib/db';

/**
 * Horizons du backfill quotidien. J+40 est absent volontairement : la série
 * partagée ne fait que 6 mois, il ne serait renseigné que pour une poignée de
 * lignes. C'est la reconstruction, qui dispose de tout l'historique, qui le
 * remplit.
 */
const HORIZONS = [5, 10, 20] as const;
const STALE = 5 * 60 * 1000;

/**
 * Complète les mesures forward manquantes en réutilisant **exactement** les
 * mêmes fonctions que la reconstruction : entrée à l'ouverture J+1, sortie en
 * clôture, RSP en primaire. Deux implémentations divergentes du même calcul
 * produiraient deux définitions du même chiffre selon la façon dont la ligne a
 * été écrite, ce qui est précisément le défaut que la reconstruction a corrigé.
 */
async function runBackfill(raw: Bar[][]): Promise<void> {
  const rows = await fetchSignalLogsNeedingBackfill();
  if (rows.length === 0) return;

  const spyHist = raw[0] ?? [];
  const rspHist = raw[1] ?? [];

  // scope='narrative' → scope_id est le ticker de l'ETF ; historiques fetchés
  // à la demande (uniquement les ETF ayant des lignes à backfiller), mémoïsés.
  const narrativeHists = new Map<string, Bar[]>();

  // Panier de pairs : mémoïsé par date, car toutes les lignes d'une même séance
  // partagent le même panier et le recalculer par ligne serait 13× le travail.
  const peerByDate = new Map<string, Map<string, number[] | null>>();
  const peerPathsFor = (date: string): Map<string, number[] | null> => {
    let m = peerByDate.get(date);
    if (!m) {
      m = new Map();
      SECTORS.forEach((s, i) => {
        m!.set(s.id, forwardPath(raw[i + 2] ?? [], date, PRIMARY_HORIZON));
      });
      peerByDate.set(date, m);
    }
    return m;
  };

  for (const row of rows) {
    let etfHist: Bar[];
    if (row.scope === 'sector') {
      const sIdx = SECTORS.findIndex(s => s.id === row.scope_id);
      if (sIdx < 0) continue;
      etfHist = raw[sIdx + 2] ?? []; // [SPY, RSP, ...ETF] → décalage +2
    } else if (row.scope === 'narrative') {
      if (!narrativeHists.has(row.scope_id)) {
        try {
          narrativeHists.set(row.scope_id, await fetchYahooHistory(row.scope_id, '6M'));
        } catch {
          narrativeHists.set(row.scope_id, []);
        }
      }
      etfHist = narrativeHists.get(row.scope_id)!;
    } else {
      continue;
    }
    if (etfHist.length === 0) continue;

    const vsRsp = relativeForward(etfHist, rspHist, row.date, HORIZONS);
    const vsSpy = relativeForward(etfHist, spyHist, row.date, HORIZONS);

    const patch: SignalPerfPatch = {};
    // Pas encore assez de bougies forward → on laisse NULL, retry au prochain
    // lancement. Et jamais d'écrasement d'une valeur déjà écrite.
    const put = (col: keyof SignalPerfPatch, cur: number | null, v: number | null): void => {
      if (cur == null && v != null) patch[col] = v;
    };

    put('rsp_perf_j5',  row.rsp_perf_j5,  vsRsp[5].relPerf);
    put('rsp_perf_j10', row.rsp_perf_j10, vsRsp[10].relPerf);
    put('rsp_perf_j20', row.rsp_perf_j20, vsRsp[20].relPerf);
    put('rel_perf_j5',  row.rel_perf_j5,  vsSpy[5].relPerf);
    put('rel_perf_j10', row.rel_perf_j10, vsSpy[10].relPerf);
    put('rel_perf_j20', row.rel_perf_j20, vsSpy[20].relPerf);
    put('mfe_j20', row.mfe_j20, vsRsp[20].mfe);
    put('mae_j20', row.mae_j20, vsRsp[20].mae);
    if (row.scope === 'sector') {
      put('peer_perf_j20', row.peer_perf_j20, peerRelPerf(peerPathsFor(row.date), row.scope_id, PRIMARY_HORIZON));
    }

    if (Object.keys(patch).length > 0) {
      await updateSignalLogPerf(row.id, patch);
    }
  }
}

// Job one-shot au démarrage : complète les mesures forward des signaux loggés
// (secteurs et narratives-ETF), en réutilisant le cache ['sector-raw'] (6M
// daily) déjà alimenté par useAlertEngine — seules les narratives à backfiller
// déclenchent des requêtes supplémentaires.
export function useSignalBackfill(): void {
  const queryClient = useQueryClient();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        const raw = await queryClient.fetchQuery<Bar[][]>({
          queryKey: ['sector-raw'],
          queryFn: () => Promise.all(SECTOR_TICKERS.map(t => fetchYahooHistory(t, '6M'))),
          staleTime: STALE,
        });
        await runBackfill(raw);
      } catch {
        // best-effort — réessaie au prochain lancement
      }
    })();
  }, [queryClient]);
}
