import type { SectorSignal } from './scoring';

/** Signaux qu'une règle peut surveiller. `null` (pas de signal) n'en fait pas partie. */
export const WATCHABLE_SIGNALS = ['reversal', 'dip', 'accelerating', 'exhaustion'] as const;
export type WatchableSignal = (typeof WATCHABLE_SIGNALS)[number];

/** Filtre par défaut d'une règle « Signaux secteurs ». */
export const DEFAULT_SIGNAL_FILTER = 'reversal,dip';

export const SIGNAL_LABELS: Record<WatchableSignal, string> = {
  reversal: 'Reversal',
  dip: 'Dip',
  accelerating: 'Accélération',
  exhaustion: 'Essoufflement',
};

/**
 * Lit la colonne `signal_filter`. `null` ou vide = tous les signaux, ce qui
 * preserve le comportement des règles créées avant l'ajout de la colonne.
 * Les valeurs inconnues sont ignorées plutôt que de faire échouer la règle.
 */
export function parseSignalFilter(raw: string | null | undefined): WatchableSignal[] {
  if (!raw) return [...WATCHABLE_SIGNALS];
  const wanted = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is WatchableSignal => (WATCHABLE_SIGNALS as readonly string[]).includes(s));
  return wanted.length > 0 ? wanted : [...WATCHABLE_SIGNALS];
}

export function serializeSignalFilter(signals: WatchableSignal[]): string | null {
  const kept = WATCHABLE_SIGNALS.filter((s) => signals.includes(s));
  // Tout coché = pas de filtre : on stocke null plutôt qu'une liste exhaustive,
  // pour que la règle suive automatiquement un futur ajout de signal.
  return kept.length === 0 || kept.length === WATCHABLE_SIGNALS.length ? null : kept.join(',');
}

export interface ScopeSignal {
  scopeId: string;
  label: string;
  signal: SectorSignal;
  score: number;
}

export interface SignalDetection {
  scopeId: string;
  label: string;
  signal: WatchableSignal;
  score: number;
  /** Signal de la veille, `null` si le scope n'en portait aucun. */
  previous: WatchableSignal | null;
}

/**
 * Détecte les signaux *nouvellement* apparus.
 *
 * `previous` vient de `signal_log` (dernière journée enregistrée avant
 * aujourd'hui) et non de `alert_events` : une règle qui couvre 11 secteurs a
 * besoin d'une mémoire par secteur, alors qu'`alert_events` n'en garde qu'une
 * par règle. Un scope absent de `previous` n'avait pas de signal — seuls les
 * signaux non-neutres sont loggés.
 *
 * `alreadyNotified` évite de re-notifier au cycle suivant : le moteur tourne
 * toutes les 60 s alors que `signal_log` n'écrit qu'une fois par jour.
 */
export function detectNewSignals(
  current: ScopeSignal[],
  previous: Record<string, string>,
  wanted: WatchableSignal[],
  alreadyNotified: Set<string> = new Set(),
): SignalDetection[] {
  const out: SignalDetection[] = [];

  for (const entry of current) {
    const signal = entry.signal;
    if (!signal) continue;
    if (!wanted.includes(signal as WatchableSignal)) continue;
    if (alreadyNotified.has(entry.scopeId)) continue;

    const prevRaw = previous[entry.scopeId];
    // Signal identique a la veille : deja signale, ce n'est pas une detection.
    if (prevRaw === signal) continue;

    const previousSignal = (WATCHABLE_SIGNALS as readonly string[]).includes(prevRaw)
      ? (prevRaw as WatchableSignal)
      : null;

    out.push({
      scopeId: entry.scopeId,
      label: entry.label,
      signal: signal as WatchableSignal,
      score: entry.score,
      previous: previousSignal,
    });
  }

  return out;
}

export function formatSignalMessage(d: SignalDetection): string {
  const name = SIGNAL_LABELS[d.signal];
  const from = d.previous ? ` (depuis ${SIGNAL_LABELS[d.previous]})` : '';
  const warn = d.signal === 'exhaustion' ? ' — signal d\'évitement' : '';
  return `${d.label} · ${name}${from} — score ${d.score}/100${warn}`;
}
