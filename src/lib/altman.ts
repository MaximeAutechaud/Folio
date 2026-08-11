import type { AnnualFigures } from './xbrl';
import { isManufacturingSic } from './sic';

/**
 * Z-Score d'Altman — prediction de defaillance.
 *
 * Trois valeurs sont calculees a chaque fois, et la distinction entre les deux
 * premieres est le coeur de ce module :
 *
 * - **Z_marche** : le Z d'origine, dont X4 rapporte la capitalisation
 *   boursiere au passif. C'est la formule publiee, mais elle est procyclique —
 *   un titre qui perd 40 % en pleine correction voit son Z se degrader alors
 *   que son bilan n'a pas bouge d'un centime.
 * - **Z_bilan** : exactement les MEMES coefficients et les memes cinq termes,
 *   ou seul X4 change pour les capitaux propres comptables.
 *
 * L'ecart entre les deux ne contient donc, par construction, que l'effet
 * marche. Comparer Z a Z'' ne permettrait PAS cette lecture : ces deux
 * formules different a la fois par leurs coefficients, par leurs seuils et par
 * le nombre de termes (Z'' abandonne X5), si bien qu'un ecart entre elles
 * melangerait l'effet marche et un changement de rotation de l'actif.
 *
 * - **Z''** : la variante d'Altman pour les non-manufacturiers, quatre termes,
 *   capitaux propres comptables, seuils propres. C'est un autre usage, pas un
 *   comparateur.
 *
 * Score **descriptif** : jamais valide en forward sur ce portefeuille, au meme
 * titre que les scores macro de l'app.
 */

export type AltmanZone = 'sur' | 'grise' | 'detresse';
export type AltmanVariant = 'z' | 'zDoublePrime';

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

  /** Variante qui fait foi, choisie sur le code SIC. */
  variant: AltmanVariant;
  /** Valeur de la variante retenue — `zMarket` pour `z`, `zDoublePrime` sinon. */
  headline: number | null;
  zone: AltmanZone | null;
  missing: string[];
}

// Coefficients d'origine (Altman 1968). X5 vaut bien 0,999 et non 1.
const Z = { x1: 1.2, x2: 1.4, x3: 3.3, x4: 0.6, x5: 0.999 } as const;
// Variante Z'' (1995) pour les non-manufacturiers : pas de X5.
const ZPP = { x1: 6.56, x2: 3.26, x3: 6.72, x4: 1.05 } as const;

const Z_ZONES = { safe: 2.99, distress: 1.81 } as const;
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
  /** Code SIC de la societe, pour le choix de variante. */
  sic: string;
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
  const { figures: f, marketCap, sic } = input;

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

  const variant: AltmanVariant = isManufacturingSic(sic) ? 'z' : 'zDoublePrime';
  const headline = variant === 'z' ? zMarket : zDoublePrime;
  const zone = zoneFor(headline, variant === 'z' ? Z_ZONES : ZPP_ZONES);

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
    variant, headline, zone, missing,
  };
}
