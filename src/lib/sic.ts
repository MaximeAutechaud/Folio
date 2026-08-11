/**
 * Classification sectorielle SIC, telle que publiee par la SEC dans
 * `submissions.sic`. Deux usages dans le scoring, et un seul endroit ou vivent
 * les bornes :
 *
 * - ecarter les societes financieres, dont le bilan ne se lit pas comme les
 *   autres (ni marge brute, ni resultat operationnel, ni distinction
 *   courant/non-courant — mesure sur JPM : 5 postes sur 12 absents) ;
 * - choisir la variante d'Altman, dont la formule d'origine est calibree sur
 *   l'industrie manufacturiere.
 */

/** Divisions SIC standard, bornes incluses. */
const MANUFACTURING = [2000, 3999] as const;
const FINANCE = [6000, 6799] as const;

function inRange(sic: string, [lo, hi]: readonly [number, number]): boolean {
  const n = Number.parseInt(sic, 10);
  return Number.isFinite(n) && n >= lo && n <= hi;
}

/**
 * Finance, assurance, immobilier. Ces societes ne recoivent **aucun** score :
 * mieux vaut afficher « non applicable » qu'un chiffre faux.
 */
export function isFinancialSic(sic: string): boolean {
  return inRange(sic, FINANCE);
}

/** Industrie manufacturiere — le perimetre sur lequel Altman a calibre le Z d'origine. */
export function isManufacturingSic(sic: string): boolean {
  return inRange(sic, MANUFACTURING);
}
