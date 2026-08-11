import type { AnnualFigures } from './xbrl';

/**
 * Z-Score d'Altman — **detecteur de defaillance, pas note de qualite**.
 *
 * Cette distinction commande tout le module. Altman a ete valide pour predire
 * la faillite a un ou deux ans : c'est un detecteur de queue de distribution.
 * Il n'a jamais ete valide pour graduer des societes saines, et s'en servir
 * pour dire si Apple est « sure » ou « tres sure » l'emploie hors de son
 * domaine. D'ou `distressSignal` : seule la zone de detresse est actionnable,
 * le reste ne doit rien affirmer.
 *
 * Mesure a l'appui, sur cinq societes : Apple sort en zone grise avec Z'' a
 * 2,31 pour un seuil a 2,60. Deux termes l'y envoient, et tous deux sont chez
 * elle des marqueurs de FORCE :
 *   - X2, ses reserves accumulees sont NEGATIVES (-14,3 Md$) parce que les
 *     rachats d'actions cumules depassent les benefices accumules ;
 *   - X1, son BFR est negatif parce qu'elle encaisse avant de payer ses
 *     fournisseurs.
 * La calibration de 1968 sur l'industrie lourde ne transpose pas aux societes
 * peu capitalistiques qui rendent du capital. Traiter cette zone grise comme un
 * avertissement produirait un faux positif sur l'une des entreprises les plus
 * solvables qui soient.
 *
 * Trois valeurs sont calculees a chaque appel :
 *
 * - **Z''** (1995, quatre termes, capitaux propres comptables) — c'est elle qui
 *   fait foi, pour toutes les societes non financieres. Ecart assume vis-a-vis
 *   d'Altman, qui reserve Z'' aux non-manufacturiers : le Z d'origine importe
 *   la capitalisation boursiere, donc le prix qu'on a delibererement exclu du
 *   score. Mesure : chez Apple, 81 % de Z_marche vient du seul rapport
 *   capitalisation/passif.
 * - **Z_marche** : le Z d'origine, X4 = capitalisation / passif. Procyclique —
 *   un titre qui perd 40 % en correction voit son Z chuter alors que son bilan
 *   n'a pas bouge. Conserve pour la lecture « ce qu'en pense le marche »,
 *   jamais pour le verdict.
 * - **Z_bilan** : memes coefficients et memes cinq termes que Z_marche, seul X4
 *   passe aux capitaux propres comptables. Leur ecart ne contient donc, par
 *   construction, que l'effet marche. Comparer Z a Z'' ne permettrait pas cette
 *   lecture : ces formules different par leurs coefficients, leurs seuils ET
 *   leur nombre de termes.
 *
 * Score **descriptif**, jamais valide en forward sur ce portefeuille.
 */

export type AltmanZone = 'sur' | 'grise' | 'detresse';

export interface AltmanScore {
  periodEnd: string;

  /** BFR / actif */
  x1: number | null;
  /** Reserves accumulees / actif */
  x2: number | null;
  /** Resultat operationnel / actif — approxime l'EBIT, la charge d'interets n'etant pas fiable */
  x3: number | null;
  /** Capitalisation / passif */
  x4Market: number | null;
  /** Capitaux propres comptables / passif */
  x4Book: number | null;
  /** CA / actif */
  x5: number | null;

  zMarket: number | null;
  zBook: number | null;
  /** `zMarket - zBook` : l'effet marche isole, les autres termes etant identiques. */
  marketEffect: number | null;
  zDoublePrime: number | null;

  /** Valeur qui fait foi : toujours `zDoublePrime`, cf. l'en-tete du module. */
  headline: number | null;
  /** Bande ou tombe `headline`. Factuel — ne pas confondre avec un verdict. */
  zone: AltmanZone | null;
  /**
   * **Le seul champ actionnable.** `true` uniquement en zone de detresse, la ou
   * Altman a une validite demontree. La zone grise ne vaut PAS avertissement :
   * Apple y figure a cause de ses rachats d'actions.
   */
  distressSignal: boolean | null;
  missing: string[];
}

// Coefficients d'origine (Altman 1968). X5 vaut bien 0,999 et non 1.
const Z = { x1: 1.2, x2: 1.4, x3: 3.3, x4: 0.6, x5: 0.999 } as const;
// Variante Z'' (1995) pour les non-manufacturiers : pas de X5.
const ZPP = { x1: 6.56, x2: 3.26, x3: 6.72, x4: 1.05 } as const;

// Seuils de Z'' uniquement : ce sont les seuls appliques, puisque Z_marche et
// Z_bilan ne servent qu'a la lecture de l'effet marche et ne rendent aucun
// verdict. (Pour memoire, ceux du Z d'origine sont 2,99 et 1,81.)
const ZPP_ZONES = { safe: 2.6, distress: 1.1 } as const;

export interface AltmanInput {
  figures: AnnualFigures;
  /**
   * Capitalisation boursiere. A calculer par l'appelant (cours courant x actions
   * en circulation) : ce module reste pur et ne connait pas Yahoo. Ne pas la
   * deriver de `dilutedShares`, qui est une moyenne ponderee sur l'exercice et
   * non un decompte a une date.
   */
  marketCap: number | null;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

/** Somme ponderee, `null` des qu'un terme manque : un Z partiel n'a aucun sens. */
function weighted(terms: [number, number | null][]): number | null {
  let total = 0;
  for (const [coef, value] of terms) {
    if (value == null) return null;
    total += coef * value;
  }
  return total;
}

function zoneFor(value: number | null, zones: { safe: number; distress: number }): AltmanZone | null {
  if (value == null) return null;
  if (value > zones.safe) return 'sur';
  if (value < zones.distress) return 'detresse';
  return 'grise';
}

export function computeAltman(input: AltmanInput): AltmanScore {
  const { figures: f, marketCap } = input;

  const workingCapital =
    f.assetsCurrent != null && f.liabilitiesCurrent != null
      ? f.assetsCurrent - f.liabilitiesCurrent
      : null;

  const x1 = ratio(workingCapital, f.assets);
  const x2 = ratio(f.retainedEarnings, f.assets);
  const x3 = ratio(f.operatingIncome, f.assets);
  const x4Market = ratio(marketCap, f.liabilities);
  const x4Book = ratio(f.stockholdersEquity, f.liabilities);
  const x5 = ratio(f.revenue, f.assets);

  // Memes coefficients, memes termes : seul X4 distingue les deux.
  const zMarket = weighted([[Z.x1, x1], [Z.x2, x2], [Z.x3, x3], [Z.x4, x4Market], [Z.x5, x5]]);
  const zBook = weighted([[Z.x1, x1], [Z.x2, x2], [Z.x3, x3], [Z.x4, x4Book], [Z.x5, x5]]);
  const zDoublePrime = weighted([
    [ZPP.x1, x1], [ZPP.x2, x2], [ZPP.x3, x3], [ZPP.x4, x4Book],
  ]);

  const marketEffect = zMarket != null && zBook != null ? zMarket - zBook : null;

  // Z'' fait foi pour toutes les societes, y compris manufacturieres : le Z
  // d'origine reimporterait la capitalisation boursiere dans un score qu'on
  // veut comptable.
  const headline = zDoublePrime;
  const zone = zoneFor(headline, ZPP_ZONES);

  const missing: string[] = [];
  if (f.assets == null) missing.push('assets');
  if (f.assetsCurrent == null) missing.push('assetsCurrent');
  if (f.liabilitiesCurrent == null) missing.push('liabilitiesCurrent');
  if (f.liabilities == null) missing.push('liabilities');
  if (f.retainedEarnings == null) missing.push('retainedEarnings');
  if (f.operatingIncome == null) missing.push('operatingIncome');
  if (f.revenue == null) missing.push('revenue');
  if (f.stockholdersEquity == null) missing.push('stockholdersEquity');
  if (marketCap == null) missing.push('marketCap');

  return {
    periodEnd: f.periodEnd,
    x1, x2, x3, x4Market, x4Book, x5,
    zMarket, zBook, marketEffect, zDoublePrime,
    headline, zone,
    distressSignal: zone == null ? null : zone === 'detresse',
    missing,
  };
}
