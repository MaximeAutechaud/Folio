import type { Point } from '../hooks/useSectorData';
import { computeSettledFor, toDateString, type ScorableEtf } from './settledSignals';

/**
 * Reconstruction de `signal_log` sur un historique complet.
 *
 * Possible — et fidèle — parce que le log est passé sur la séance close : la
 * fonction qui consigne au fil de l'eau (`computeSettledFor`) est exactement
 * celle qu'on rejoue ici à une date passée. Ce ne sont pas deux mesures à ne pas
 * mélanger, c'est la même appliquée à des dates différentes.
 *
 * Ce que la reconstruction corrige au passage :
 * - les lignes de week-end (l'ancien code estampillait « aujourd'hui », même un
 *   dimanche, en recopiant la classification du vendredi) ;
 * - les signaux intraday qui n'existaient plus à la clôture (~19 % des lignes) ;
 * - les trous des jours où l'application n'a pas été ouverte.
 */

export const FORWARD_HORIZONS = [5, 10, 20] as const;

export interface RebuiltRow {
  date: string;
  scope: 'sector' | 'narrative';
  scopeId: string;
  signal: string;
  score: number;
  relPerfJ5: number | null;
  relPerfJ10: number | null;
  relPerfJ20: number | null;
}

/**
 * Index de la première bougie dont la date est >= `date`, `-1` si la série
 * s'arrête avant. Dichotomie : les dates d'une série Yahoo sont croissantes, et
 * cette fonction est appelée six fois par ligne reconstruite (trois horizons ×
 * ETF + SPY) — en balayage linéaire elle domine tout le coût sur 16 ans.
 */
export function findBarIndex(hist: Point[], date: string): number {
  let lo = 0, hi = hist.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (toDateString(hist[mid].time) < date) lo = mid + 1;
    else hi = mid;
  }
  return lo < hist.length ? lo : -1;
}

function pct(hist: Point[], i0: number, i1: number): number | null {
  const a = hist[i0]?.value;
  const b = hist[i1]?.value;
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / a) * 100;
}

/**
 * Performance relative à SPY sur `bars` séances après `date`.
 * `null` tant que les bougies futures n'existent pas — une ligne récente reste
 * donc incomplète jusqu'à ce que le marché ait avancé, et c'est correct.
 */
export function forwardRelPerf(
  etfHist: Point[], spyHist: Point[], date: string, bars: number,
): number | null {
  const iEtf = findBarIndex(etfHist, date);
  const iSpy = findBarIndex(spyHist, date);
  if (iEtf < 0 || iSpy < 0) return null;
  if (iEtf + bars >= etfHist.length || iSpy + bars >= spyHist.length) return null;
  const e = pct(etfHist, iEtf, iEtf + bars);
  const s = pct(spyHist, iSpy, iSpy + bars);
  return e != null && s != null ? e - s : null;
}

/**
 * Séances exploitables d'une série de référence : toutes les bougies closes,
 * hors journée en cours. `minBars` écarte le début de série, où RSI, MA50 et
 * drawdown 6M n'auraient pas assez de profondeur pour être justes.
 */
export function tradingSessions(
  reference: Point[], minBars = 130, nowSec = Date.now() / 1000,
): { date: string; time: number }[] {
  const today = toDateString(nowSec);
  const out: { date: string; time: number }[] = [];
  for (let i = minBars; i < reference.length; i++) {
    const date = toDateString(reference[i].time);
    if (date >= today) break;
    out.push({ date, time: reference[i].time });
  }
  return out;
}

/** Séances entre deux respirations. Assez pour que le surcoût des `setTimeout`
 *  reste négligeable, assez peu pour que la barre de progression bouge. */
const YIELD_EVERY = 25;

/**
 * Rejoue le calcul sur chaque séance.
 *
 * Asynchrone parce que sur 16 ans la boucle dure des dizaines de secondes :
 * synchrone, elle gèlerait la fenêtre et aucun `onProgress` ne serait rendu
 * avant la fin. On rend la main au navigateur toutes les `YIELD_EVERY` séances.
 */
export async function rebuildRange(
  entries: ScorableEtf[],
  scope: 'sector' | 'narrative',
  histories: Record<string, Point[]>,
  macroHistories: Record<string, Point[]>,
  sessions: { date: string; time: number }[],
  onProgress?: (done: number, total: number) => void,
): Promise<RebuiltRow[]> {
  const spy = histories['SPY'] ?? [];
  const etfById = new Map(entries.map(e => [e.id, e.etf]));
  const rows: RebuiltRow[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    for (const s of computeSettledFor(entries, histories, macroHistories, session.time)) {
      if (!s.signal) continue; // seuls les signaux non-neutres sont consignés
      const etf = etfById.get(s.sectorId);
      const hist = etf ? histories[etf] ?? [] : [];
      rows.push({
        date: session.date,
        scope,
        scopeId: s.sectorId,
        signal: s.signal,
        score: s.score,
        relPerfJ5: forwardRelPerf(hist, spy, session.date, 5),
        relPerfJ10: forwardRelPerf(hist, spy, session.date, 10),
        relPerfJ20: forwardRelPerf(hist, spy, session.date, 20),
      });
    }
    onProgress?.(i + 1, sessions.length);
    if ((i + 1) % YIELD_EVERY === 0) await new Promise(r => setTimeout(r, 0));
  }

  return rows;
}
