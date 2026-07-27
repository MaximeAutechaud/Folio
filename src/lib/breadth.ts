/**
 * Breadth de constituants — % de titres d'un secteur au-dessus de leur moyenne
 * mobile, séance par séance.
 *
 * **Pourquoi ce module existe.** Tous les indicateurs techniques (RSI, MACD,
 * Bollinger…) sont des transformations déterministes de la série de prix qu'on
 * leur donne : ils n'ajoutent aucune information à un moteur qui voit déjà
 * cette série. La breadth est la seule exception accessible ici — elle lit le
 * prix des ~900 **constituants**, que le moteur ne voit pas, et pas celui de
 * l'ETF sectoriel. C'est un élargissement de la source, pas une reprojection.
 *
 * **Ce que ce module ne fait pas.** Il ne produit ni signal ni score. La
 * question ouverte est de savoir si la breadth dit quelque chose que le
 * momentum de l'ETF ne dit pas déjà ; tant que ce n'est pas mesuré, rien ne
 * doit consommer ces séries en détection.
 *
 * ## Le dénominateur est le point de vigilance
 *
 * `universe-seed.ts` est un relevé des holdings IVV/IJH **au 26 juillet 2026**.
 * En détection live c'est sans objet, mais une breadth historique calculée sur
 * cette liste ne voit que les sociétés qui ont survécu jusqu'en 2026 : elle est
 * structurellement **surestimée dans le passé**, et l'ampleur du biais décroît
 * à mesure qu'on se rapproche du présent. Contrairement au scanner
 * d'accélération — où la survivance jouait en faveur du scanner et où le
 * résultat était nul quand même — ici le biais contamine directement la
 * grandeur mesurée.
 *
 * Conséquence pratique, et raison pour laquelle `count` est exposé sur chaque
 * point plutôt que masqué : **aucune comparaison de niveau entre deux époques
 * n'est licite**. Seules les variations à horizon court le sont, à effectif
 * quasi constant.
 */

import type { Bar } from './scanner';

/** Un point de breadth, avec l'effectif qui l'a produit. */
export interface BreadthPoint {
  time: number;
  /** Part des constituants éligibles au-dessus de leur MM, en pourcentage. */
  pctAbove: number;
  /**
   * Nombre de constituants ayant effectivement contribué à cette date.
   *
   * Exposé délibérément : c'est la seule trace du biais de survivance, et une
   * série dont le `count` dérive ne se lit pas en niveau.
   */
  count: number;
}

/**
 * Position d'un titre vis-à-vis de sa moyenne mobile, indexée par date.
 *
 * La MM est calculée sur les bougies **du titre**, jamais sur un calendrier
 * commun : un titre qui n'a pas coté ce jour-là ne doit pas hériter du prix de
 * la veille, il doit simplement ne pas compter. Les séries Yahoo ont des trous
 * (suspensions, cotations tardives), et un report de valeur fabriquerait une
 * MM plate et un `pctAbove` faussement stable.
 */
function aboveMaByTime(bars: Bar[], window: number): Map<number, boolean> {
  const out = new Map<number, boolean>();
  if (bars.length < window) return out;
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].value;
    if (i >= window) sum -= bars[i - window].value;
    // La MM du jour inclut la clôture du jour : `window` valeurs disponibles
    // à partir de l'indice `window - 1`.
    if (i >= window - 1) out.set(bars[i].time, bars[i].value > sum / window);
  }
  return out;
}

/**
 * Série de breadth sur un calendrier de référence.
 *
 * `timeline` vient de l'instrument de référence (l'ETF sectoriel) et non de
 * l'union des dates des membres : c'est le calendrier sur lequel on mesurera
 * les perfs forward, et le seul qui garantisse qu'un point de breadth existe
 * exactement là où une décision serait prise.
 *
 * Aucun seuil d'effectif minimal n'est appliqué ici — `count` est rendu, le
 * filtrage appartient à l'appelant, qui seul connaît sa tolérance.
 */
export function breadthSeries(members: Bar[][], timeline: number[], window = 50): BreadthPoint[] {
  const maps = members.map(bars => aboveMaByTime(bars, window));
  const out: BreadthPoint[] = [];
  for (const time of timeline) {
    let above = 0;
    let count = 0;
    for (const map of maps) {
      const flag = map.get(time);
      if (flag === undefined) continue;
      count++;
      if (flag) above++;
    }
    out.push({ time, pctAbove: count ? (above / count) * 100 : 0, count });
  }
  return out;
}

/**
 * Variation de breadth sur `lookback` séances, en points de pourcentage.
 *
 * C'est la forme utilisable de la série : le niveau est contaminé par la
 * survivance (cf. en-tête), la variation à horizon court beaucoup moins,
 * l'effectif bougeant peu sur quelques semaines.
 *
 * `null` tant que l'antériorité manque, pour que l'appelant ne confonde pas
 * « pas encore calculable » et « variation nulle ».
 */
export function breadthDelta(series: BreadthPoint[], lookback: number): (number | null)[] {
  return series.map((point, i) =>
    i < lookback ? null : point.pctAbove - series[i - lookback].pctAbove,
  );
}

/**
 * Momentum de l'ETF sur `lookback` séances, en pourcentage.
 *
 * Aligné sur le même calendrier et la même convention de décalage que
 * `breadthDelta` : c'est la grandeur dont il faut résidualiser la breadth pour
 * savoir si elle apporte autre chose que le prix déjà connu.
 */
export function etfMomentum(bars: Bar[], lookback: number): (number | null)[] {
  return bars.map((bar, i) => {
    if (i < lookback) return null;
    const base = bars[i - lookback].value;
    return base === 0 ? null : ((bar.value - base) / base) * 100;
  });
}

/**
 * Paires (breadth, momentum) définies aux deux bouts, dans l'ordre du
 * calendrier.
 *
 * Les deux séries doivent partager le même calendrier de référence — c'est le
 * contrat de `breadthSeries(members, timeline)` avec `timeline` issu des
 * bougies de l'ETF. La fonction ne réaligne rien : elle suppose l'alignement
 * et se contente d'écarter les indices où l'une des deux valeurs manque.
 */
export function pairedSeries(
  a: (number | null)[],
  b: (number | null)[],
): { a: number[]; b: number[] } {
  const outA: number[] = [];
  const outB: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x == null || y == null) continue;
    outA.push(x);
    outB.push(y);
  }
  return { a: outA, b: outB };
}
