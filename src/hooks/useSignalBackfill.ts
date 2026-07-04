import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchYahooHistory } from '../lib/api/yahoo';
import { SECTORS } from '../lib/sectors';
import { SECTOR_TICKERS } from './useSectorData';
import { fetchSignalLogsNeedingBackfill, updateSignalLogPerf } from '../lib/db';

type Point = { time: number; value: number };

const HORIZONS = [5, 10, 20] as const;
const STALE = 5 * 60 * 1000;

function toDateStr(timeSec: number): string {
  const d = new Date(timeSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Index de la première bougie dont la date locale est >= la date du signal.
function findBarIndex(hist: Point[], date: string): number {
  for (let i = 0; i < hist.length; i++) {
    if (toDateStr(hist[i].time) >= date) return i;
  }
  return -1;
}

function pct(hist: Point[], i0: number, i1: number): number | null {
  const a = hist[i0]?.value;
  const b = hist[i1]?.value;
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / a) * 100;
}

async function runBackfill(raw: Point[][]): Promise<void> {
  const rows = await fetchSignalLogsNeedingBackfill();
  if (rows.length === 0) return;

  const spyHist = raw[0] ?? [];

  for (const row of rows) {
    if (row.scope !== 'sector') continue;
    const sIdx = SECTORS.findIndex(s => s.id === row.scope_id);
    if (sIdx < 0) continue;
    const etfHist = raw[sIdx + 2] ?? []; // [SPY, RSP, ...ETF] → décalage +2

    const iEtf = findBarIndex(etfHist, row.date);
    const iSpy = findBarIndex(spyHist, row.date);
    if (iEtf < 0 || iSpy < 0) continue;

    const cur = { j5: row.rel_perf_j5, j10: row.rel_perf_j10, j20: row.rel_perf_j20 };
    const patch: { j5?: number; j10?: number; j20?: number } = {};

    for (const n of HORIZONS) {
      const key = `j${n}` as 'j5' | 'j10' | 'j20';
      if (cur[key] != null) continue;
      // Pas encore assez de bougies forward → on laisse NULL, retry au prochain lancement.
      if (iEtf + n >= etfHist.length || iSpy + n >= spyHist.length) continue;
      const etfFwd = pct(etfHist, iEtf, iEtf + n);
      const spyFwd = pct(spyHist, iSpy, iSpy + n);
      if (etfFwd != null && spyFwd != null) patch[key] = etfFwd - spyFwd;
    }

    if (Object.keys(patch).length > 0) {
      await updateSignalLogPerf(row.id, patch);
    }
  }
}

// Job one-shot au démarrage : calcule les perfs forward (J+5/J+10/J+20 vs SPY)
// des signaux loggés, en réutilisant le cache ['sector-raw'] (6M daily) déjà
// alimenté par useAlertEngine → zéro requête supplémentaire.
export function useSignalBackfill(): void {
  const queryClient = useQueryClient();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        const raw = await queryClient.fetchQuery<Point[][]>({
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
