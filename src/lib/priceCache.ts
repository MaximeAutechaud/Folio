import type { ScannerBar } from './api/yahoo';
import type { PriceBarRow } from './db';

/**
 * Décisions de synchronisation du cache de prix — logique pure, testable sans
 * réseau ni base.
 */

/**
 * Profondeur d'historique conservée.
 *
 * Deux ans et non un, alors que le scanner ne lit jamais plus de 126 séances.
 * La profondeur excédentaire ne sert pas au scan mais à sa **validation** : le
 * rejeu à une date passée exige 125 séances de warm-up (60 de base turnover,
 * 60 de corrélation), donc un an d'historique ne laisse qu'une vingtaine de
 * dates rejouables — et toutes postérieures aux thèmes nés dans la première
 * moitié de la fenêtre. On ne peut alors pas mesurer si le scanner détecte tôt,
 * ce qui est précisément la question. Deux ans en offrent ~130.
 *
 * Le coût est du stockage : ~460 000 lignes, quelques dizaines de Mo. Sans
 * commune mesure avec l'intérêt de pouvoir falsifier la détection.
 */
export const RETENTION_DAYS = 760;

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
 * Dernière séance qu'on peut **espérer** trouver chez Yahoo : le dernier jour
 * de semaine à la date donnée.
 *
 * Sans cette notion, un cache à jour au vendredi paraît en retard de deux jours
 * le dimanche, et une synchronisation de week-end retélécharge l'univers entier
 * pour ne rien apprendre — deux jours sur sept, plus les fériés.
 *
 * Les jours fériés ne sont pas modélisés : la liste dépend de la place, change
 * chaque année et vieillirait mal. Le coût d'un férié est une synchronisation
 * inutile ce jour-là, qui se corrige d'elle-même le lendemain — sans commune
 * mesure avec la complexité d'un calendrier boursier à maintenir.
 */
export function lastExpectedSession(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return toDateString(Math.floor(d.getTime() / 1000));
}

/**
 * Fenêtre à demander pour un ticker, selon ce que le cache contient déjà.
 *
 * Ce qui coûte n'est pas la taille du téléchargement mais le **nombre d'allers-
 * retours** : 900 requêtes séquentielles prennent quelques minutes quelle que
 * soit leur charge utile. Le seul vrai levier est donc de ne pas demander ce
 * qu'on a déjà — d'où la comparaison à `lastExpectedSession` plutôt qu'à la date
 * du jour.
 *
 * Le recouvrement, lui, est volontairement plus large que le trou. Une bougie
 * déjà connue est simplement ré-écrite par l'upsert, alors qu'un trou laissé
 * béant fausse silencieusement toutes les fenêtres glissantes qui le traversent.
 */
export function rangeFor(
  latest: string | undefined,
  today: string,
  earliest?: string,
): string | null {
  if (!latest) return '2y';
  // Un cache peut être frais mais trop peu profond. Ne regarder que MAX(date)
  // laissait un historique d'un an « à jour » pour toujours malgré la
  // rétention de deux ans.
  if (earliest && daysBetween(earliest, today) < 500) return '2y';
  if (latest >= lastExpectedSession(today)) return null; // rien de nouveau à attendre

  const gap = daysBetween(latest, today);
  if (gap <= 5) return '5d';
  if (gap <= 20) return '1mo';
  if (gap <= 80) return '3mo';
  if (gap <= 170) return '6mo';
  if (gap <= 350) return '1y';
  return '2y';
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
