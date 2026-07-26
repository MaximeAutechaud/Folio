import type { Point } from '../hooks/useSectorData';
import type { Bar } from './api/yahoo';
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

/**
 * Horizons mesurés. J+40 est ajouté parce qu'un profil « peu de gagnants, mais
 * de gros gagnants » a besoin de place pour se déployer : arrêter la mesure à
 * 20 séances tronque mécaniquement la queue droite qu'on cherche à détecter.
 */
export const FORWARD_HORIZONS = [5, 10, 20, 40] as const;

/** Horizon primaire pré-enregistré (cf. docs/AUDIT §6.1). */
export const PRIMARY_HORIZON = 20;

export interface RebuiltRow {
  date: string;
  scope: 'sector' | 'narrative';
  scopeId: string;
  signal: string;
  score: number;
  /** Primaire : vs RSP, le benchmark qui alimente déjà la détection. */
  rspJ5: number | null;
  rspJ10: number | null;
  rspJ20: number | null;
  rspJ40: number | null;
  /** Excursions extrêmes du parcours relatif (vs RSP), en clôture. */
  mfeJ20: number | null;
  maeJ20: number | null;
  mfeJ40: number | null;
  maeJ40: number | null;
  /** Secondaire : vs SPY — continuité de lecture avec l'ancien log. */
  relPerfJ5: number | null;
  relPerfJ10: number | null;
  relPerfJ20: number | null;
  /** Secondaire : vs panier équipondéré des autres secteurs (secteurs seuls). */
  peerJ20: number | null;
  /** Contexte au moment du signal — support des découpes de diagnostic. */
  ma50Above: boolean | null;
  macroScore: number;
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

/**
 * Parcours de rendement d'un trade réellement exécutable, en %.
 *
 * Convention (cf. docs/AUDIT §4.9) :
 *
 * ```text
 * Signal connu à la clôture de J   → aucune exécution possible ce jour-là
 * Entrée à l'ouverture de J+1
 * Sortie à la clôture de J+n
 * ```
 *
 * L'ancienne mesure partait de la clôture de J, c'est-à-dire du prix qui venait
 * de produire le signal : elle s'octroyait une exécution impossible. Le
 * décalage n'est pas neutre — c'est justement sur cette ouverture que se
 * matérialise le gap de réaction.
 *
 * `path[k - 1]` est le rendement à la clôture de la k-ième séance après J.
 * Retourne `null` si la bougie d'entrée n'existe pas encore ; le tableau est
 * simplement plus court quand l'historique s'arrête avant `maxBars`, ce qui
 * laisse les horizons non atteints à `null` au lieu de les inventer.
 */
export function forwardPath(hist: Bar[], date: string, maxBars: number): number[] | null {
  const i = findBarIndex(hist, date);
  if (i < 0) return null;
  const entry = hist[i + 1]?.open;
  if (entry == null || entry === 0) return null;

  const path: number[] = [];
  for (let k = 1; k <= maxBars; k++) {
    const close = hist[i + k]?.value;
    if (close == null) break;
    path.push(((close - entry) / entry) * 100);
  }
  return path;
}

export interface ForwardMeasure {
  /** Performance relative à l'échéance, en points de %. */
  relPerf: number | null;
  /** Maximum favorable excursion : meilleur point du parcours jusqu'à l'échéance. */
  mfe: number | null;
  /** Maximum adverse excursion : pire point du parcours jusqu'à l'échéance. */
  mae: number | null;
}

/**
 * Parcours **relatif** à un benchmark, et ses excursions extrêmes.
 *
 * MFE et MAE sont ce qui rend une espérance asymétrique observable : une moyenne
 * nulle peut recouvrir soit un bruit symétrique, soit une queue droite épaisse
 * qu'une sortie asymétrique récolterait. La moyenne seule ne distingue pas les
 * deux, et c'est la question qui décide de tout le reste.
 *
 * Les excursions sont mesurées **en clôture** et non sur les extrêmes intraday :
 * le plus haut du secteur et celui du benchmark ne se produisent pas au même
 * instant de la séance, donc leur différence ne correspondrait à aucun écart
 * réellement atteignable.
 */
export function relativeForward(
  etf: Bar[], bench: Bar[], date: string, horizons: readonly number[],
): Record<number, ForwardMeasure> {
  const out: Record<number, ForwardMeasure> = {};
  for (const h of horizons) out[h] = { relPerf: null, mfe: null, mae: null };

  const maxH = Math.max(...horizons);
  const e = forwardPath(etf, date, maxH);
  const b = forwardPath(bench, date, maxH);
  if (!e || !b) return out;

  const wanted = new Set(horizons);
  const n = Math.min(e.length, b.length);
  let mfe = -Infinity;
  let mae = Infinity;
  for (let k = 0; k < n; k++) {
    const rel = e[k] - b[k];
    if (rel > mfe) mfe = rel;
    if (rel < mae) mae = rel;
    const h = k + 1;
    if (wanted.has(h)) out[h] = { relPerf: rel, mfe, mae };
  }
  return out;
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
  histories: Record<string, Bar[]>,
  macroHistories: Record<string, Point[]>,
  sessions: { date: string; time: number }[],
  onProgress?: (done: number, total: number) => void,
): Promise<RebuiltRow[]> {
  const spy = histories['SPY'] ?? [];
  const rsp = histories['RSP'] ?? [];
  const etfById = new Map(entries.map(e => [e.id, e.etf]));
  const rows: RebuiltRow[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const signals = computeSettledFor(entries, histories, macroHistories, session.time)
      .filter(s => s.signal); // seuls les signaux non-neutres sont consignés

    // Panier équipondéré des pairs : pour une rotation, le benchmark
    // conceptuellement juste est « les autres membres de l'univers », puisque
    // c'est ce que mesure un rang. Calculé sur les instruments qui ont un signal
    // *et* sur ceux qui n'en ont pas serait plus large, mais l'univers scoré
    // suffit : on veut savoir si ce secteur-là a battu ses pairs.
    const peerPath = new Map<string, number[] | null>();
    if (scope === 'sector') {
      for (const e of entries) {
        peerPath.set(e.id, forwardPath(histories[e.etf] ?? [], session.date, PRIMARY_HORIZON));
      }
    }

    for (const s of signals) {
      const etf = etfById.get(s.sectorId);
      const hist = etf ? histories[etf] ?? [] : [];

      const vsRsp = relativeForward(hist, rsp, session.date, FORWARD_HORIZONS);
      const vsSpy = relativeForward(hist, spy, session.date, FORWARD_HORIZONS);

      rows.push({
        date: session.date,
        scope,
        scopeId: s.sectorId,
        signal: s.signal!,
        score: s.score,
        rspJ5: vsRsp[5].relPerf,
        rspJ10: vsRsp[10].relPerf,
        rspJ20: vsRsp[20].relPerf,
        rspJ40: vsRsp[40].relPerf,
        mfeJ20: vsRsp[20].mfe,
        maeJ20: vsRsp[20].mae,
        mfeJ40: vsRsp[40].mfe,
        maeJ40: vsRsp[40].mae,
        relPerfJ5: vsSpy[5].relPerf,
        relPerfJ10: vsSpy[10].relPerf,
        relPerfJ20: vsSpy[20].relPerf,
        peerJ20: peerRelPerf(peerPath, s.sectorId, PRIMARY_HORIZON),
        ma50Above: s.ma50Above,
        macroScore: s.macroScore,
      });
    }

    onProgress?.(i + 1, sessions.length);
    if ((i + 1) % YIELD_EVERY === 0) await new Promise(r => setTimeout(r, 0));
  }

  return rows;
}

/**
 * Écart au rendement moyen des **autres** instruments de l'univers, à `horizon`.
 *
 * Le secteur mesuré est exclu de son propre benchmark : l'inclure diluerait
 * l'écart d'un facteur 1/N et rendrait la mesure dépendante de la taille de
 * l'univers. `null` s'il n'y a aucun pair mesurable à cet horizon.
 */
export function peerRelPerf(
  paths: Map<string, number[] | null>, selfId: string, horizon: number,
): number | null {
  const own = paths.get(selfId)?.[horizon - 1];
  if (own == null) return null;

  let sum = 0;
  let n = 0;
  for (const [id, path] of paths) {
    if (id === selfId) continue;
    const v = path?.[horizon - 1];
    if (v == null) continue;
    sum += v;
    n++;
  }
  return n === 0 ? null : own - sum / n;
}
