import type { AnnualFigures } from './xbrl';

/**
 * Indicateurs affiches **a cote** du score, jamais dedans.
 *
 * La separation est structurelle et non cosmetique : melanger « bonne
 * entreprise » et « pas chere » produit une note ininterpretable. Piotroski
 * lui-meme s'appliquait a des univers deja filtres par la valorisation, pas en
 * confondant les deux dans un chiffre unique.
 *
 * DEUX ECARTS par rapport a la specification initiale, imposes par la mesure :
 *
 * 1. **Pas d'EBITDA.** Les dotations aux amortissements n'ont pas de tag
 *    exploitable : Microsoft n'en publie aucune des trois variantes courantes,
 *    Marvell quatre exercices, Apple en utilise trois successives. `EV/EBITDA`
 *    et `dette nette / EBITDA` sont donc remplaces par leurs equivalents sur le
 *    resultat operationnel et le cash-flow d'exploitation, disponibles a 19/19.
 *    Ce n'est pas qu'un repli : le CFO mesure mieux la capacite a servir la
 *    dette que l'EBITDA, qui ignore le besoin en fonds de roulement.
 *
 * 2. **DSO et rotation des stocks sont des indicateurs de TENDANCE**, a lire
 *    dans le temps sur une meme societe. Les comparer entre societes n'a aucun
 *    sens : un editeur de logiciels n'a pas de stocks et un distributeur
 *    encaisse comptant.
 */

export interface ContextIndicators {
  periodEnd: string;

  // ── Valorisation — exige la capitalisation ────────────────────────────────
  /** Capitalisation / resultat net. `null` si la societe perd de l'argent. */
  priceEarnings: number | null;
  /** Flux de tresorerie disponible rapporte a la capitalisation. */
  freeCashFlowYield: number | null;
  /** Valeur d'entreprise / resultat operationnel — a la place d'EV/EBITDA. */
  enterpriseValueToEbit: number | null;

  // ── Structure financiere — purement comptable ─────────────────────────────
  /** Cash-flow d'exploitation moins investissements corporels. */
  freeCashFlow: number | null;
  freeCashFlowMargin: number | null;
  /** Dette long terme moins tresorerie. Negatif = tresorerie nette. */
  netDebt: number | null;
  /** Annees de cash-flow d'exploitation necessaires a rembourser la dette nette. */
  netDebtToOperatingCashFlow: number | null;
  /** Resultat operationnel / charge d'interets. Souvent `null` — cf. en-tete. */
  interestCoverage: number | null;

  // ── Qualite des profits — a lire en TENDANCE uniquement ───────────────────
  /** Delai moyen de reglement client, en jours. */
  daysSalesOutstanding: number | null;
  /** Jours de stock, rapportes au cout des ventes. */
  inventoryDays: number | null;
}

const DAYS_PER_YEAR = 365;

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

export interface ContextInput {
  figures: AnnualFigures;
  /** Capitalisation boursiere ; `null` neutralise les seuls ratios de valorisation. */
  marketCap: number | null;
}

export function computeContextIndicators(input: ContextInput): ContextIndicators {
  const { figures: f, marketCap } = input;

  const freeCashFlow =
    f.operatingCashFlow != null && f.capex != null ? f.operatingCashFlow - f.capex : null;

  const netDebt = f.longTermDebt != null && f.cash != null ? f.longTermDebt - f.cash : null;

  const enterpriseValue =
    marketCap != null && netDebt != null ? marketCap + netDebt : null;

  // Cout des ventes reconstitue : le poste n'est pas expose, mais CA - marge
  // brute le donne exactement.
  const costOfRevenue =
    f.revenue != null && f.grossProfit != null ? f.revenue - f.grossProfit : null;

  return {
    periodEnd: f.periodEnd,

    // Un PER sur resultat negatif n'a pas de sens : on ne l'affiche pas plutot
    // que de sortir un nombre negatif qui se lirait comme « bon marche ».
    priceEarnings:
      f.netIncome != null && f.netIncome > 0 ? ratio(marketCap, f.netIncome) : null,
    freeCashFlowYield: ratio(freeCashFlow, marketCap),
    enterpriseValueToEbit:
      f.operatingIncome != null && f.operatingIncome > 0
        ? ratio(enterpriseValue, f.operatingIncome)
        : null,

    freeCashFlow,
    freeCashFlowMargin: ratio(freeCashFlow, f.revenue),
    netDebt,
    // Une societe en tresorerie nette n'a pas de ratio d'endettement a afficher.
    netDebtToOperatingCashFlow:
      netDebt != null && netDebt > 0 ? ratio(netDebt, f.operatingCashFlow) : null,
    interestCoverage:
      f.interestExpense != null && f.interestExpense > 0
        ? ratio(f.operatingIncome, f.interestExpense)
        : null,

    daysSalesOutstanding:
      f.receivables != null && f.revenue != null && f.revenue !== 0
        ? (f.receivables / f.revenue) * DAYS_PER_YEAR
        : null,
    inventoryDays:
      f.inventory != null && costOfRevenue != null && costOfRevenue > 0
        ? (f.inventory / costOfRevenue) * DAYS_PER_YEAR
        : null,
  };
}
