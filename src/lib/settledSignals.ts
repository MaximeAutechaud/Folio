import { computeEtfMetrics, calcBenchWindows, BARS, type Point } from '../hooks/useSectorData';
import { computeMacroAt } from './macroScore';
import { calcSectorScore, type SectorSignal } from './scoring';
import { SECTORS, type MacroProfile } from './sectors';

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
  /**
   * Contexte du signal, remonté pour être **persisté** dans `signal_log`.
   *
   * Les deux étaient déjà calculés ici mais jetés à la sortie de la fonction, ce
   * qui rendait impossible toute découpe « au-dessus/sous la MA50 » ou « macro
   * favorable/défavorable » sans rejouer seize ans d'historique à chaque
   * consultation. Ce sont précisément les deux critères que le score traite en
   * commentaire plutôt qu'en condition d'entrée — les mesurer est le seul moyen
   * de savoir s'ils devraient devenir des conditions.
   */
  ma50Above: boolean | null;
  macroScore: number;
}

/** Instrument scoré : un secteur, ou une narrative via son ETF de référence. */
export interface ScorableEtf {
  /** Identifiant consigné dans signal_log.scope_id. */
  id: string;
  label: string;
  etf: string;
  macroProfile: MacroProfile;
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

/**
 * Profondeur d'historique fournie à `computeEtfMetrics`, **en séances**.
 *
 * 130 couvre la plus longue fenêtre du calcul (126 séances pour `drawdown6M`,
 * 63 pour le RSI, 50 pour la MA50) avec un peu de marge.
 *
 * Ce n'est plus qu'une borne de performance. `computeEtfMetrics` bornait
 * autrefois `high6M` au plus haut de *toute la série reçue*, si bien qu'un
 * historique long non tronqué produisait un « plus haut 6 mois » sur seize ans,
 * donc un drawdown faux. La fenêtre est maintenant bornée dans le calcul
 * lui-même : tronquer ici évite de recopier 4 000 bougies par séance, mais ne
 * décide plus de la justesse du résultat.
 */
export const SECTOR_WINDOW_BARS = 130;

/**
 * Fenêtre macro. `computeMacroAt` ne remonte jamais au-delà d'une perf 1M
 * finissant une semaine avant la séance, soit 37 jours ; 60 laisse de la marge.
 *
 * Borner ne change aucun résultat : le seul test portant sur le début de série
 * (`earliest`, qui décide si `scorePrev` est calculable) reste vrai dès que
 * 37 jours existent, et reste faux si la série est réellement plus courte.
 * Sans cette borne, chaque séance recopierait tout l'historique macro — sans
 * effet visible sur 2 ans, rédhibitoire sur 16.
 */
export const MACRO_WINDOW_DAYS = 60;

/** Premier index dont `time >= t`. Séries Yahoo : temps croissants. */
function lowerBound(series: Point[], t: number): number {
  let lo = 0, hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Premier index dont `time > t`. */
function upperBound(series: Point[], t: number): number {
  let lo = 0, hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].time <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Dichotomie plutôt que `filter` : la reconstruction appelle cette fonction une
 * fois par instrument **et par séance**. Sur 16 ans (~4 200 séances × ~50
 * instruments), un balayage linéaire de la série complète coûte ~10⁹
 * comparaisons ; la dichotomie ne copie que la fenêtre demandée.
 */
export function truncate(series: Point[], atTime: number, spanDays?: number): Point[] {
  const start = spanDays != null ? lowerBound(series, atTime - spanDays * 86400) : 0;
  const end = upperBound(series, atTime);
  return start >= end ? [] : series.slice(start, end);
}

/**
 * Même troncature, bornée en **nombre de bougies** plutôt qu'en jours
 * calendaires : les `bars` dernières séances closes à `atTime`.
 *
 * C'est la variante qu'utilise le moteur de signaux. Une borne calendaire
 * livrait un nombre de bougies variable (jours fériés, longs week-ends), donc
 * une profondeur d'historique qui fluctuait d'une séance à l'autre.
 *
 * Reste en dichotomie sur la borne haute : appelée une fois par instrument *et*
 * par séance, un balayage linéaire rendrait le coût quadratique en longueur de
 * série — invisible sur 2 ans, rédhibitoire sur 16.
 */
export function truncateBars(series: Point[], atTime: number, bars: number): Point[] {
  const end = upperBound(series, atTime);
  return series.slice(Math.max(0, end - bars), end);
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
  return computeSettledFor(
    SECTORS.map(s => ({ id: s.id, label: s.name, etf: s.etf, macroProfile: s.macroProfile })),
    sectorHistories, macroHistories, atTime,
  );
}

/** Même calcul, pour un ensemble quelconque d'instruments (secteurs, narratives). */
export function computeSettledFor(
  entries: ScorableEtf[],
  histories: Record<string, Point[]>,
  macroHistories: Record<string, Point[]>,
  atTime: number,
): SettledSignal[] {
  const spy = truncateBars(histories['SPY'] ?? [], atTime, SECTOR_WINDOW_BARS);
  const rsp = truncateBars(histories['RSP'] ?? [], atTime, SECTOR_WINDOW_BARS);
  if (spy.length < 60) return [];

  const macro = computeMacroAt(
    Object.fromEntries(
      Object.entries(macroHistories).map(([k, v]) => [k, truncate(v, atTime, MACRO_WINDOW_DAYS)]),
    ),
    atTime,
  );

  const spyBench = calcBenchWindows(spy, BARS.m3);
  const rspBench = calcBenchWindows(rsp, BARS.m3);

  const out: SettledSignal[] = [];
  for (const entry of entries) {
    const raw = truncateBars(histories[entry.etf] ?? [], atTime, SECTOR_WINDOW_BARS);
    if (raw.length < 60) continue;
    const m = computeEtfMetrics(raw, spyBench, rspBench, BARS.m3);
    const score = calcSectorScore({
      relPerf1W: m.relPerf1W_ew,
      relPerf1M: m.relPerf1M_ew,
      relPerf3M: m.relPerf3M_ew,
      rsi: m.rsi,
      drawdown3M: m.drawdown3M,
      drawdown6M: m.drawdown6M,
      ma50Above: m.ma50Above,
      macroProfile: entry.macroProfile,
      macroScore: macro.score,
      macroTrend: macro.trend,
    });
    out.push({
      sectorId: entry.id,
      label: entry.label,
      signal: score.signal,
      score: score.total,
      ma50Above: score.ma50Above,
      macroScore: macro.score,
    });
  }
  return out;
}
