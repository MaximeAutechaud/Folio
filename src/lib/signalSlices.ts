import type { SignalLogRow } from '../types';
import {
  toEpisodes,
  horizonStat,
  excursionStat,
  MIN_EPISODES,
  type SignalKind,
  type HorizonStat,
  type ExcursionStat,
} from './signalStats';

/**
 * Découpes de diagnostic de la Phase 1 (cf. `docs/AUDIT-SIGNAUX-ROTATION-SECTORIELLE.md` §7).
 *
 * Le résultat agrégé est nul : espérance ≈ 0, win rate posé sur la baseline de
 * 49 %, MFE/MAE ≈ 1 sur les quatre signaux. Reste la question que le plan laisse
 * explicitement ouverte : **une sous-population possède-t-elle déjà un avantage
 * que l'agrégat noie ?**
 *
 * ## Pourquoi ce module est dangereux, et comment il s'en protège
 *
 * C'est ici que vit le surapprentissage. Découper 4 signaux × 6 axes × ~5
 * buckets × 4 horizons, c'est ~500 comparaisons sur des observations qui se
 * chevauchent et sont corrélées en coupe. À ce compte-là on trouve *toujours*
 * une cellule flatteuse : c'est arithmétique, pas de la découverte.
 *
 * Trois garde-fous, tous structurels plutôt que déclaratifs :
 *
 * 1. **Cible primaire pré-enregistrée** (`PRIMARY_TARGET`) — une seule, figée
 *    dans le code avant d'avoir regardé les résultats. Tout le reste est marqué
 *    `exploratory` et doit se lire comme tel.
 * 2. **Plancher de puissance** (`MIN_EPISODES`) — un bucket sous le plancher
 *    n'est pas un résultat, quelle que soit sa valeur. Porté par `underpowered`
 *    sur chaque bucket, jamais masqué : cacher les petits buckets inviterait à
 *    croire que les gros disent quelque chose de plus.
 * 3. **Segment hors-échantillon scellé** (`OUT_OF_SAMPLE_FROM`) — écarté par
 *    défaut de toute découpe. C'est une cartouche unique : une fois consultée,
 *    tout test ultérieur sur cette période est in-sample et ne prouve plus rien.
 */

/** Première date du segment hors-échantillon. Cf. §6.6 de l'audit. */
export const OUT_OF_SAMPLE_FROM = '2022-01-01';

/**
 * Cible primaire pré-enregistrée, déclarée **avant** consultation des découpes.
 *
 * Ce n'est pas de la documentation : c'est l'engagement qui rend le reste
 * interprétable. Une hypothèse choisie après avoir vu les chiffres n'est pas une
 * hypothèse, c'est une description.
 */
export const PRIMARY_TARGET = {
  universe: 'sector',
  signal: 'reversal' as SignalKind,
  horizon: 40,
  benchmark: 'RSP',
  /** Seuil MFE/MAE à 3σ de 1, compte tenu du clustering transversal. */
  minExcursionRatio: 1.15,
  /** Espérance nette minimale par épisode, ≈ 3× les frais aller-retour. */
  minExpectancy: 0.5,
} as const;

export type SliceAxis = 'score' | 'sector' | 'year' | 'ma50' | 'macro';

export interface SliceBucket {
  /** Libellé du bucket, ordonné pour l'affichage. */
  label: string;
  /** Épisodes tombant dans ce bucket. */
  total: number;
  stat: HorizonStat;
  excursion: ExcursionStat;
  /** Sous le plancher de puissance statistique. */
  underpowered: boolean;
}

export interface SliceResult {
  axis: SliceAxis;
  /** Horizon mesuré, en séances. */
  horizon: number;
  buckets: SliceBucket[];
  /** Épisodes écartés faute de valeur sur l'axe (ex. MA50 nulle). */
  unclassified: number;
  /**
   * `true` dès que la découpe n'est pas la cible pré-enregistrée. Toute
   * conclusion tirée d'une découpe exploratoire demande une validation sur une
   * période neuve.
   */
  exploratory: boolean;
}

/** Colonnes de mesure disponibles par horizon, benchmark primaire (RSP). */
function perfAt(row: SignalLogRow, horizon: number): number | null {
  switch (horizon) {
    case 5:  return row.rsp_perf_j5;
    case 10: return row.rsp_perf_j10;
    case 20: return row.rsp_perf_j20;
    case 40: return row.rsp_perf_j40;
    default: return null;
  }
}

function excursionAt(row: SignalLogRow, horizon: number): [number | null, number | null] {
  return horizon >= 40 ? [row.mfe_j40, row.mae_j40] : [row.mfe_j20, row.mae_j20];
}

/**
 * Tranches de score. Bornes reprises telles quelles du §6.4 de l'audit — donc
 * choisies avant d'avoir vu la moindre performance par tranche.
 */
export const SCORE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0–49',   min: 0,  max: 49 },
  { label: '50–59',  min: 50, max: 59 },
  { label: '60–69',  min: 60, max: 69 },
  { label: '70–79',  min: 70, max: 79 },
  { label: '80–100', min: 80, max: 100 },
];

/**
 * Macro favorable / défavorable. Le seuil 50 est le point neutre de
 * `calcMacroScore`, pas un réglage : le déplacer serait déjà de l'optimisation.
 */
const MACRO_NEUTRAL = 50;

function bucketOf(row: SignalLogRow, axis: SliceAxis): string | null {
  switch (axis) {
    case 'score':
      return SCORE_BUCKETS.find(b => row.score >= b.min && row.score <= b.max)?.label ?? null;
    case 'sector':
      return row.scope_id;
    case 'year':
      return row.date.slice(0, 4);
    case 'ma50':
      // `null` est signifiant (série trop courte) → non classé, pas rangé d'office
      // dans « sous la MA50 », ce qui polluerait le bucket le plus intéressant.
      return row.ma50_above == null ? null : (row.ma50_above ? 'Au-dessus MA50' : 'Sous MA50');
    case 'macro':
      if (row.macro_score == null) return null;
      return row.macro_score >= MACRO_NEUTRAL ? 'Macro favorable' : 'Macro défavorable';
  }
}

/** Ordre d'affichage : naturel pour score/MA50/macro, alphabétique sinon. */
function bucketOrder(axis: SliceAxis): string[] | null {
  switch (axis) {
    case 'score': return SCORE_BUCKETS.map(b => b.label);
    case 'ma50':  return ['Au-dessus MA50', 'Sous MA50'];
    case 'macro': return ['Macro favorable', 'Macro défavorable'];
    default:      return null; // tri alphabétique = chronologique pour l'année
  }
}

export interface SliceOptions {
  axis: SliceAxis;
  signal: SignalKind;
  horizon: number;
  /**
   * Inclure le segment hors-échantillon. `false` par défaut, et ce défaut est le
   * garde-fou : la cartouche ne se dépense que sur une demande explicite.
   */
  includeOutOfSample?: boolean;
}

/**
 * Découpe les épisodes d'un signal selon un axe, et mesure chaque bucket.
 *
 * `rows` est réduit en épisodes **avant** filtrage sur le signal : `toEpisodes`
 * a besoin de voir tous les scopes et tous les signaux pour distinguer « le
 * signal a cessé » de « l'app n'a pas tourné ». Filtrer d'abord casserait cette
 * distinction et inventerait des épisodes.
 */
export function sliceSignal(rows: SignalLogRow[], opts: SliceOptions): SliceResult {
  const { axis, signal, horizon, includeOutOfSample = false } = opts;

  const episodes = toEpisodes(rows)
    .filter(r => r.signal === signal)
    .filter(r => includeOutOfSample || r.date < OUT_OF_SAMPLE_FROM);

  const groups = new Map<string, SignalLogRow[]>();
  let unclassified = 0;
  for (const r of episodes) {
    const key = bucketOf(r, axis);
    if (key == null) { unclassified++; continue; }
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }

  const order = bucketOrder(axis);
  const keys = order
    ? order.filter(k => groups.has(k))
    : [...groups.keys()].sort();

  const buckets: SliceBucket[] = keys.map(label => {
    const g = groups.get(label)!;
    const excursions = g.map(r => excursionAt(r, horizon));
    return {
      label,
      total: g.length,
      stat: horizonStat(signal, g.map(r => perfAt(r, horizon))),
      excursion: excursionStat(signal, excursions.map(e => e[0]), excursions.map(e => e[1])),
      underpowered: g.length < MIN_EPISODES,
    };
  });

  return {
    axis,
    horizon,
    buckets,
    unclassified,
    exploratory: !(
      signal === PRIMARY_TARGET.signal && horizon === PRIMARY_TARGET.horizon
    ),
  };
}

/**
 * Un bucket franchit-il les deux seuils pré-enregistrés ?
 *
 * Les trois conditions sont conjonctives et non négociables : espérance ≥ 3× les
 * frais, asymétrie du parcours réellement distinguable de 1, et échantillon
 * au-dessus du plancher de puissance. Un bucket qui n'en satisfait que deux n'est
 * pas « presque » un résultat — c'est un résultat négatif.
 */
export function meetsPrimaryThreshold(b: SliceBucket): boolean {
  return (
    !b.underpowered
    && b.stat.expectancy != null && b.stat.expectancy >= PRIMARY_TARGET.minExpectancy
    && b.excursion.ratio != null && b.excursion.ratio >= PRIMARY_TARGET.minExcursionRatio
  );
}

/**
 * Verdict du critère d'arrêt de la Phase 1, sur un ensemble de découpes.
 *
 * `false` ⇒ « les signaux actuels restent descriptifs, ne pas poursuivre
 * l'optimisation de leurs seuils » — la conclusion que l'audit demande d'assumer
 * plutôt que d'ouvrir une boucle d'ajustement indéfinie.
 */
export function anySurvivingBucket(results: SliceResult[]): boolean {
  return results.some(r => r.buckets.some(meetsPrimaryThreshold));
}
