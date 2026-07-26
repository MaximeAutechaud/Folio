/**
 * Détection de narratives naissantes.
 *
 * ## Le problème reformulé
 *
 * On ne détecte pas un thème : on détecte **un groupe de titres anormalement
 * corrélés qui ne devraient pas l'être**. Nommer le groupe (« mémoire »,
 * « photonique ») est une étape humaine, et c'est la bonne place pour un humain.
 *
 * ## Pourquoi ça ne peut pas partir des secteurs
 *
 * Une narrative naissante, c'est cinq ou six mid caps. Dans un ETF sectoriel
 * pondéré par la capitalisation elles pèsent ~1,5 % : si elles prennent 30 %,
 * l'ETF bouge de 0,45 %, sous le bruit de ses variations journalières. Le signal
 * sectoriel est **aveugle par construction** au phénomène recherché. Ce n'est
 * pas un seuil mal réglé, c'est de l'arithmétique de pondération.
 *
 * ## Ce que le secteur sert quand même à faire
 *
 * Mesuré sur 16 ans, l'écart-type des espérances **inter-secteurs** vaut 0,52 pt
 * contre 0,09 pt **inter-signaux** : le secteur explique six fois plus de
 * variance que n'importe quel signal. C'est exactement ce qui en fait un mauvais
 * sélecteur et un excellent **contrôle** — on le soustrait au lieu de filtrer
 * dessus (`residualize`). Sans cette soustraction, le scanner redécouvre « la
 * tech monte » à chaque rallye tech : c'est le piège qui avait produit un
 * `dip xlk` à +1,14 % qui n'était que la dérive de VGT.
 */

import type { ScannerBar } from './api/yahoo';

/**
 * Bougie du scanner. Alias de `ScannerBar` : le type appartient à la couche qui
 * le produit, pour qu'il n'existe qu'une seule définition de ce qu'est une
 * bougie ajustée.
 */
export type Bar = ScannerBar;

// ── Étage 1 : afflux de liquidité ────────────────────────────────────────────

/**
 * Turnover = dollar volume, c'est-à-dire l'argent réellement échangé.
 *
 * Le volume brut ne se compare pas d'un titre à l'autre (un million d'actions à
 * 3 $ n'est pas un million d'actions à 300 $) ni dans le temps pour un même
 * titre dont le cours a doublé. Le dollar volume, si.
 */
export function dollarVolume(b: Bar): number {
  return b.value * b.volume;
}

export interface LiquidityStat {
  /** Écart-type du dollar volume récent vs sa base, en unités robustes. */
  z: number;
  /** Séances consécutives au-dessus du seuil, en fin de série. */
  streak: number;
  /** Dollar volume médian de la base — sert de plancher de tradabilité. */
  baseline: number;
}

/**
 * Anomalie de liquidité en fin de série.
 *
 * Médiane et MAD plutôt que moyenne et écart-type : la distribution du dollar
 * volume est fortement asymétrique et contient des pics de résultats
 * trimestriels. Une moyenne et un écart-type classiques seraient tirés par ces
 * pics et rendraient anormal ce qui est normal.
 *
 * `streak` porte la distinction qui fait tout le travail : **un pic n'est pas un
 * afflux**. Un jour à ×5 est un événement (résultats, news, inclusion dans un
 * indice). Cinq à dix séances consécutivement élevées est un changement de
 * régime de liquidité — c'est ça, de l'argent qui arrive.
 */
export function liquidityStat(bars: Bar[], baseBars = 60, z = 1.0): LiquidityStat | null {
  if (bars.length < baseBars + 5) return null;

  const dv = bars.map(dollarVolume);
  const base = dv.slice(-baseBars - 1, -1); // exclut la séance en cours de la base
  const med = median(base);
  const mad = median(base.map(v => Math.abs(v - med)));
  if (med <= 0 || mad <= 0) return null;

  // 1.4826 : facteur de cohérence MAD → écart-type pour une loi normale.
  const scale = 1.4826 * mad;
  const zOf = (v: number) => (v - med) / scale;

  let streak = 0;
  for (let i = dv.length - 1; i >= 0; i--) {
    if (zOf(dv[i]) >= z) streak++;
    else break;
  }

  return { z: zOf(dv[dv.length - 1]), streak, baseline: med };
}

export interface CandidateFilter {
  /** Séances consécutives d'afflux exigées. Un pic isolé n'est pas un afflux. */
  minStreak: number;
  /** Écart minimal à la base, en MAD. */
  minZ: number;
  /** Dollar volume médian minimal — seul filtre légitime sur l'entrée. */
  minBaseline: number;
  /**
   * Distance minimale au plus haut 52 semaines, en %. Le filtre « naissant » :
   * on veut l'argent qui arrive **avant** que le mouvement soit consommé, pas
   * après. Négatif (ex. −5 signifie « au moins 5 % sous le plus haut »).
   */
  maxProximityToHigh: number;
}

export const DEFAULT_FILTER: CandidateFilter = {
  minStreak: 5,
  minZ: 1.0,
  minBaseline: 5_000_000,
  maxProximityToHigh: -3,
};

export interface Candidate {
  ticker: string;
  z: number;
  streak: number;
  baseline: number;
  /** Écart au plus haut 52 semaines, en % (≤ 0). */
  distToHigh: number;
}

/**
 * Étage 1 — les titres où l'argent arrive et où le mouvement n'est pas consommé.
 *
 * **Cette sortie ne doit jamais être exposée telle quelle.** Un titre isolé avec
 * un pic de volume n'est pas une trouvaille, c'est du bruit avec un résultat
 * trimestriel derrière ; et une liste de tickers sans thèse produit des achats
 * sans thèse. Elle n'existe que comme entrée de l'étage 2.
 */
export function scanCandidates(
  series: Record<string, Bar[]>, filter: CandidateFilter = DEFAULT_FILTER,
): Candidate[] {
  const out: Candidate[] = [];
  for (const [ticker, bars] of Object.entries(series)) {
    const stat = liquidityStat(bars, 60, filter.minZ);
    if (!stat) continue;
    if (stat.streak < filter.minStreak) continue;
    if (stat.z < filter.minZ) continue;
    if (stat.baseline < filter.minBaseline) continue;

    const window = bars.slice(-252);
    const high = Math.max(...window.map(b => b.value));
    const last = bars[bars.length - 1].value;
    const distToHigh = high > 0 ? ((last - high) / high) * 100 : 0;
    if (distToHigh > filter.maxProximityToHigh) continue;

    out.push({ ticker, z: stat.z, streak: stat.streak, baseline: stat.baseline, distToHigh });
  }
  return out.sort((a, b) => b.z - a.z);
}

// ── Étage 3 : résidualisation ────────────────────────────────────────────────

/** Rendements journaliers d'une série, en %. */
export function returns(bars: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1].value;
    out.push(a === 0 ? 0 : ((bars[i].value - a) / a) * 100);
  }
  return out;
}

/** Pente de la régression de `y` sur `x` par les moindres carrés (bêta). */
export function beta(y: number[], x: number[]): number {
  const n = Math.min(y.length, x.length);
  if (n < 2) return 0;
  const my = mean(y.slice(-n));
  const mx = mean(x.slice(-n));
  let cov = 0;
  let varx = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[x.length - n + i] - mx;
    cov += (y[y.length - n + i] - my) * dx;
    varx += dx * dx;
  }
  return varx === 0 ? 0 : cov / varx;
}

/**
 * Rendements résiduels : ce qui reste après avoir retiré le marché et le secteur.
 *
 * ```text
 * r_résiduel = r_titre − β_marché · r_marché − β_secteur · r_secteur
 * ```
 *
 * C'est le seul étage réellement critique de tout le scanner. Sans lui, tout
 * corrèle dans un rallye et on « découvre » chaque mois que la tech monte
 * ensemble. Avec lui, deux titres qui restent corrélés le sont pour une raison
 * qui n'est **ni le marché ni leur secteur** — soit la définition opérationnelle
 * d'une narrative.
 *
 * Marché et secteur sont eux-mêmes fortement corrélés, donc les régresser
 * naïvement l'un après l'autre ne suffit **pas** : retirer le marché, puis
 * retirer le secteur du résidu, laisse une exposition marché résiduelle (le
 * secteur en réintroduit sa propre part). C'est l'orthogonalisation de
 * Gram-Schmidt qui règle le problème, et elle porte sur le **facteur**, pas sur
 * le résidu :
 *
 * 1. `sector⊥` = la part du secteur qui n'est pas du marché ;
 * 2. le titre est régressé sur `market` et `sector⊥`, qui sont orthogonaux entre
 *    eux — les deux coefficients sont donc indépendants et exacts.
 *
 * L'ordre encode la hiérarchie voulue : le marché explique d'abord, le secteur
 * n'explique que ce qu'il ajoute. Testé par une reconstruction exacte — un titre
 * qui n'est qu'une combinaison des deux facteurs a un résidu nul à 1e-9 près.
 */
export function residualize(stock: number[], market: number[], sector?: number[]): number[] {
  const n = sector
    ? Math.min(stock.length, market.length, sector.length)
    : Math.min(stock.length, market.length);
  if (n < 2) return [];

  const tail = (a: number[]) => a.slice(a.length - n);
  const s = tail(stock);
  const m = tail(market);

  if (!sector) {
    const bm = beta(s, m);
    return s.map((v, i) => v - bm * m[i]);
  }

  const k = tail(sector);
  const bkm = beta(k, m);
  const kPerp = k.map((v, i) => v - bkm * m[i]);

  const bm = beta(s, m);
  const bk = beta(s, kPerp);
  return s.map((v, i) => v - bm * m[i] - bk * kPerp[i]);
}

/** Corrélation de Pearson. `0` si l'une des séries est constante. */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const x = a.slice(a.length - n);
  const y = b.slice(b.length - n);
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

// ── Étage 2 : clustering ─────────────────────────────────────────────────────

export interface ClusterInput {
  ticker: string;
  /** Rendements résiduels, déjà nettoyés du marché et du secteur. */
  residuals: number[];
  /** Secteur de rattachement, pour exiger qu'un cluster en traverse plusieurs. */
  sectorId: string | null;
}

export interface Cluster {
  tickers: string[];
  /** Corrélation résiduelle moyenne entre membres. */
  cohesion: number;
  /** Secteurs distincts représentés. */
  sectors: string[];
}

export interface ClusterOptions {
  /** Corrélation résiduelle minimale pour relier deux titres. */
  minCorrelation: number;
  /** Taille minimale d'un groupe. En dessous, ce n'est pas un thème. */
  minSize: number;
  /**
   * Nombre minimal de secteurs distincts. `1` accepte les thèmes intra-sectoriels
   * (la mémoire vit entièrement dans la tech), `2` ne garde que les thèmes
   * transverses. Défaut à 1 : exiger 2 raterait la mémoire, qui est justement
   * l'exemple qui a motivé le chantier.
   */
  minSectors: number;
  /**
   * Cohésion minimale — corrélation moyenne sur **toutes** les paires du groupe.
   *
   * Sans ce seuil, les composantes connexes chaînent : un seul titre corrélé à
   * beaucoup relie tout le graphe. Un rejeu sur 2010-2026 a produit, le jour du
   * choc tarifaire d'avril 2025, un « cluster » de **166 titres à 0,06 de
   * cohésion** — pendant un choc de marché tout corrèle, y compris les résidus.
   *
   * Le seuil vaut `minCorrelation` par construction, et ce n'est pas un réglage
   * ajusté aux données : un groupe n'est un thème que si ses membres sont *en
   * moyenne* aussi corrélés que ce qu'on exige d'un lien isolé. Une chaîne
   * échoue ce test par définition.
   *
   * Limite assumée : on **écarte** le groupe au lieu de le scinder. Les
   * composantes connexes ne savent pas séparer un vrai sous-thème noyé dans un
   * blob ; il faudrait un critère de clique pour ça.
   */
  minCohesion: number;
}

export const DEFAULT_CLUSTER: ClusterOptions = {
  minCorrelation: 0.5,
  minSize: 4,
  minSectors: 1,
  minCohesion: 0.5,
};

/**
 * Étage 2 — regroupe les candidats en narratives.
 *
 * Composantes connexes du graphe où deux titres sont reliés si leur corrélation
 * résiduelle dépasse le seuil. Volontairement pas de k-means ni de clustering
 * hiérarchique : le nombre de thèmes est inconnu et variable, et une méthode qui
 * impose un nombre de groupes en inventerait là où il n'y en a pas.
 *
 * Le coût est négligeable malgré le O(n²) : le clustering ne tourne que sur les
 * candidats de l'étage 1, soit quelques dizaines de titres, jamais sur l'univers
 * complet.
 */
export function findClusters(
  inputs: ClusterInput[], opts: ClusterOptions = DEFAULT_CLUSTER,
): Cluster[] {
  const n = inputs.length;
  if (n < opts.minSize) return [];

  const corr: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = correlation(inputs[i].residuals, inputs[j].residuals);
      corr[i][j] = c;
      corr[j][i] = c;
    }
  }

  // Composantes connexes par parcours en largeur.
  const seen = new Array(n).fill(false);
  const clusters: Cluster[] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const group: number[] = [];
    const queue = [i];
    seen[i] = true;
    while (queue.length) {
      const cur = queue.shift()!;
      group.push(cur);
      for (let j = 0; j < n; j++) {
        if (!seen[j] && corr[cur][j] >= opts.minCorrelation) {
          seen[j] = true;
          queue.push(j);
        }
      }
    }
    if (group.length < opts.minSize) continue;

    const sectors = [...new Set(group.map(k => inputs[k].sectorId).filter((s): s is string => s != null))];
    if (sectors.length < opts.minSectors) continue;

    // Cohésion : corrélation moyenne sur toutes les paires du groupe, y compris
    // celles qui ne sont pas directement reliées — une composante connexe peut
    // être une chaîne, et une chaîne n'est pas un thème.
    let sum = 0;
    let pairs = 0;
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        sum += corr[group[a]][group[b]];
        pairs++;
      }
    }
    const cohesion = pairs ? sum / pairs : 0;
    if (cohesion < opts.minCohesion) continue;

    clusters.push({
      tickers: group.map(k => inputs[k].ticker).sort(),
      cohesion,
      sectors: sectors.sort(),
    });
  }

  return clusters.sort((a, b) => b.cohesion - a.cohesion);
}

// ── Composition des étages ───────────────────────────────────────────────────

/** Fenêtre de corrélation. Assez longue pour être stable, assez courte pour
 *  qu'un thème né il y a deux mois domine encore le résidu. */
export const CORRELATION_BARS = 60;

export interface BuildInputsDeps {
  /** Secteur d'un ticker, `null` si inconnu. */
  sectorOf: (ticker: string) => string | null;
  /** ETF représentant un secteur, `null` si absent du cache. */
  etfOf: (sectorId: string) => string | null;
  /** Ticker du benchmark de marché. */
  marketTicker: string;
}

/**
 * Prépare les entrées du clustering : rendements résiduels de chaque candidat.
 *
 * Un candidat dont le marché ou le secteur manque au cache est **écarté**, pas
 * résidualisé à moitié. Un titre nettoyé du marché mais pas de son secteur
 * corrélerait avec ses pairs sectoriels sur ce reliquat, et formerait un cluster
 * qui n'est qu'un secteur déguisé — exactement ce que la résidualisation existe
 * pour empêcher. Mieux vaut un candidat de moins qu'un faux thème.
 */
export function buildClusterInputs(
  candidates: Candidate[],
  series: Record<string, Bar[]>,
  deps: BuildInputsDeps,
  bars = CORRELATION_BARS,
): { inputs: ClusterInput[]; dropped: string[] } {
  const marketRet = returns((series[deps.marketTicker] ?? []).slice(-bars - 1));
  const inputs: ClusterInput[] = [];
  const dropped: string[] = [];

  if (marketRet.length < 3) return { inputs, dropped: candidates.map(c => c.ticker) };

  for (const c of candidates) {
    const sectorId = deps.sectorOf(c.ticker);
    const etf = sectorId ? deps.etfOf(sectorId) : null;
    const sectorRet = etf ? returns((series[etf] ?? []).slice(-bars - 1)) : [];

    if (!sectorId || sectorRet.length < 3) { dropped.push(c.ticker); continue; }

    const own = returns((series[c.ticker] ?? []).slice(-bars - 1));
    if (own.length < 3) { dropped.push(c.ticker); continue; }

    const residuals = residualize(own, marketRet, sectorRet);
    if (residuals.length < 3) { dropped.push(c.ticker); continue; }

    inputs.push({ ticker: c.ticker, residuals, sectorId });
  }

  return { inputs, dropped };
}

/**
 * Séries tronquées à une date passée, en secondes Unix.
 *
 * Rejouer le scan à une date antérieure n'est possible que parce que tous les
 * étages lisent la **fin** de la série : couper la fin suffit à replacer le
 * scanner dans l'état où il était ce jour-là. Aucune donnée future ne subsiste,
 * ce qui est la condition d'un backtest honnête.
 */
export function truncateAt(
  series: Record<string, Bar[]>, asOfSec: number,
): Record<string, Bar[]> {
  const out: Record<string, Bar[]> = {};
  for (const [ticker, bars] of Object.entries(series)) {
    let hi = bars.length;
    while (hi > 0 && bars[hi - 1].time > asOfSec) hi--;
    if (hi > 0) out[ticker] = bars.slice(0, hi);
  }
  return out;
}

export interface RunScanInput {
  /** Toutes les séries, instruments de contrôle compris. */
  series: Record<string, Bar[]>;
  /** Un instrument de contrôle est un benchmark, jamais un candidat. */
  isControl: (ticker: string) => boolean;
  deps: BuildInputsDeps;
  filter?: CandidateFilter;
  clusterOpts?: ClusterOptions;
}

export interface RunScanOutput {
  clusters: Cluster[];
  candidates: Candidate[];
  dropped: string[];
}

/**
 * Enchaîne les trois étages.
 *
 * Existe pour qu'il n'y ait **qu'une seule** définition de « faire un scan » :
 * l'application et tout harnais de validation appellent cette fonction. Deux
 * compositions parallèles finiraient par diverger, et on mesurerait alors autre
 * chose que ce qui est affiché — le défaut exact que la reconstruction de
 * signaux avait dû corriger sur l'autre branche.
 */
export function runScan(input: RunScanInput): RunScanOutput {
  const { series, isControl, deps, filter = DEFAULT_FILTER, clusterOpts = DEFAULT_CLUSTER } = input;

  const candidateSeries: Record<string, Bar[]> = {};
  for (const [ticker, bars] of Object.entries(series)) {
    if (!isControl(ticker)) candidateSeries[ticker] = bars;
  }

  const candidates = scanCandidates(candidateSeries, filter);
  const { inputs, dropped } = buildClusterInputs(candidates, series, deps);
  return { clusters: findClusters(inputs, clusterOpts), candidates, dropped };
}

// ── Utilitaires ──────────────────────────────────────────────────────────────

function mean(a: number[]): number {
  return a.length === 0 ? 0 : a.reduce((s, v) => s + v, 0) / a.length;
}

function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
