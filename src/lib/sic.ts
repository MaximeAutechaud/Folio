/**
 * Classification sectorielle SIC, telle que publiee par la SEC dans
 * `submissions.sic`.
 *
 * Un seul usage, et un seul endroit ou vivent les bornes : ecarter les societes
 * financieres, dont le bilan ne se lit pas comme les autres — ni marge brute,
 * ni resultat operationnel, ni distinction courant/non-courant. Mesure sur
 * JPMorgan : 5 postes sur 12 absents.
 *
 * Il n'y a volontairement pas de test « manufacturier » : Altman applique la
 * meme variante (Z'') a toutes les societes non financieres, cf. `altman.ts`.
 */

/** Division SIC « Finance, Insurance, Real Estate », bornes incluses. */
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
