import type { ScannerBar } from './api/yahoo';
import type { PriceBarRow } from './db';

/**
 * Décisions de synchronisation du cache de prix — logique pure, testable sans
 * réseau ni base.
 */

/** Profondeur d'historique conservée. Le scanner ne regarde jamais au-delà. */
export const RETENTION_DAYS = 400;

/** `YYYY-MM-DD` d'un timestamp Unix, en UTC. */
export function toDateString(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/**
 * Fenêtre à demander pour un ticker, selon ce que le cache contient déjà.
 *
 * Le mode incrémental n'est pas une optimisation cosmétique : sur 900 tickers,
 * un an complet représente environ trois minutes de requêtes séquentielles là où
 * un mois en prend une quinzaine de secondes. Une synchronisation quotidienne
 * doit être assez légère pour qu'on la lance sans y penser.
 *
 * Le recouvrement est volontaire — on redemande plus large que le trou. Une
 * bougie déjà connue est simplement ré-écrite par l'upsert, alors qu'un trou
 * laissé béant fausse silencieusement toutes les fenêtres glissantes qui le
 * traversent.
 */
export function rangeFor(latest: string | undefined, today: string): string | null {
  if (!latest) return '1y';
  const gap = daysBetween(latest, today);
  if (gap <= 0) return null;   // déjà à jour
  if (gap <= 20) return '1mo';
  if (gap <= 80) return '3mo';
  if (gap <= 170) return '6mo';
  return '1y';
}

/** Bougies Yahoo → lignes de la table. */
export function toRows(bars: ScannerBar[]): PriceBarRow[] {
  return bars.map(b => ({
    ticker: '',                       // renseigné par upsertPriceBars
    date: toDateString(b.time),
    open: b.open,
    value: b.value,
    close: b.close,
    volume: b.volume,
  }));
}

/**
 * Lignes de la table → bougies du scanner.
 *
 * `time` est reconstruit à midi UTC et non à minuit : minuit tombe la veille
 * dans les fuseaux négatifs, et une bougie datée d'un jour de trop décalerait
 * toutes les fenêtres d'une séance.
 */
export function toBars(rows: PriceBarRow[]): ScannerBar[] {
  return rows.map(r => ({
    time: Math.floor(Date.parse(`${r.date}T12:00:00Z`) / 1000),
    open: r.open ?? r.value,
    value: r.value,
    close: r.close ?? r.value,
    volume: r.volume,
  }));
}

export interface SyncOutcome {
  ticker: string;
  ok: boolean;
  bars: number;
}

export interface SyncReport {
  requested: number;
  /** Tickers ayant renvoyé au moins une bougie. */
  resolved: number;
  /**
   * Tickers n'ayant rien renvoyé.
   *
   * **C'est le garde-fou du chantier.** La table d'exceptions de `toYahooTicker`
   * ne couvre que les cas rencontrés ; sur 900 tickers, deux ou trois échecs
   * silencieux passeraient totalement inaperçus et amputeraient des clusters
   * sans qu'aucun symptôme n'apparaisse. Un cluster incomplet ne se signale pas.
   */
  unresolved: string[];
  bars: number;
  skipped: number;
}

export function buildReport(outcomes: SyncOutcome[], skipped: number): SyncReport {
  const unresolved = outcomes.filter(o => !o.ok).map(o => o.ticker).sort();
  return {
    requested: outcomes.length + skipped,
    resolved: outcomes.length - unresolved.length,
    unresolved,
    bars: outcomes.reduce((s, o) => s + o.bars, 0),
    skipped,
  };
}

/** Date de purge : au-delà, les bougies ne servent plus à rien. */
export function pruneBefore(today: string, retentionDays = RETENTION_DAYS): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - retentionDays);
  return toDateString(Math.floor(d.getTime() / 1000));
}
