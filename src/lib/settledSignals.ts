import { computeEtfMetrics, calcBenchWindows, type Point } from '../hooks/useSectorData';
import { computeMacroAt } from './macroScore';
import { calcSectorScore, type SectorSignal } from './scoring';
import { SECTORS } from './sectors';

/**
 * Signal d'un secteur pour une séance donnée, calculé **sur la clôture**.
 *
 * Pourquoi : mesuré en séance, le score repose sur une bougie journalière encore
 * ouverte. Comparé au log réel sur 126 lignes, cela produit ~19 % de signaux
 * intraday qui n'existent plus le soir (le live voyait un signal là où la
 * clôture n'en voit aucun dans 24 cas sur 32 désaccords). Ce qu'on consigne et
 * ce qui déclenche une alerte doit donc être la clôture ; l'affichage temps réel
 * reste libre de montrer l'intraday.
 *
 * Corollaire : cette fonction est aussi celle d'une reconstruction a posteriori.
 * Log et rattrapage historique deviennent le même calcul, pas deux mesures.
 */

export interface SettledSignal {
  sectorId: string;
  label: string;
  signal: SectorSignal;
  score: number;
}

/** Fin de séance (UTC) de la date `YYYY-MM-DD`. */
export function sessionEnd(date: string): number {
  return Math.floor(new Date(`${date}T23:59:59Z`).getTime() / 1000);
}

export function toDateString(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Dernière séance **terminée** d'une série journalière : la dernière bougie
 * dont la date est antérieure à aujourd'hui. La bougie du jour est écartée même
 * après la clôture — Yahoo la révise encore, et l'exclure rend le résultat
 * indépendant de l'heure d'exécution.
 *
 * `null` si la série n'a aucune bougie plus ancienne qu'aujourd'hui.
 */
export function lastSettledSession(
  reference: Point[], nowSec = Date.now() / 1000,
): { date: string; time: number } | null {
  const today = toDateString(nowSec);
  for (let i = reference.length - 1; i >= 0; i--) {
    const date = toDateString(reference[i].time);
    if (date < today) return { date, time: reference[i].time };
  }
  return null;
}

/** Ne garde que les bougies jusqu'à la séance visée — aucune donnée future. */
export function truncate(series: Point[], atTime: number): Point[] {
  return series.filter(p => p.time <= atTime);
}

/**
 * Signaux des 13 secteurs pour la séance `atTime`.
 *
 * `sectorHistories` est indexé par ticker d'ETF, `macroHistories` par ticker
 * macro — tous deux en pas journalier et couvrant au moins ~6 mois avant
 * `atTime`, sans quoi RSI, MA50 et drawdown 6M sont faux.
 */
export function computeSettledSignals(
  sectorHistories: Record<string, Point[]>,
  macroHistories: Record<string, Point[]>,
  atTime: number,
): SettledSignal[] {
  const spy = truncate(sectorHistories['SPY'] ?? [], atTime);
  const rsp = truncate(sectorHistories['RSP'] ?? [], atTime);
  if (spy.length < 60) return [];

  const macro = computeMacroAt(
    Object.fromEntries(
      Object.entries(macroHistories).map(([k, v]) => [k, truncate(v, atTime)]),
    ),
    atTime,
  );

  const spyBench = calcBenchWindows(spy, 93, atTime);
  const rspBench = calcBenchWindows(rsp, 93, atTime);

  const out: SettledSignal[] = [];
  for (const sector of SECTORS) {
    const raw = truncate(sectorHistories[sector.etf] ?? [], atTime);
    if (raw.length < 60) continue;
    const m = computeEtfMetrics(raw, spyBench, rspBench, 93, atTime);
    const score = calcSectorScore({
      relPerf1W: m.relPerf1W_ew,
      relPerf1M: m.relPerf1M_ew,
      relPerf3M: m.relPerf3M_ew,
      rsi: m.rsi,
      drawdown3M: m.drawdown3M,
      drawdown6M: m.drawdown6M,
      ma50Above: m.ma50Above,
      macroProfile: sector.macroProfile,
      macroScore: macro.score,
      macroTrend: macro.trend,
    });
    out.push({ sectorId: sector.id, label: sector.name, signal: score.signal, score: score.total });
  }
  return out;
}
