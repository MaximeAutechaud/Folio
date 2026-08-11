import type { AnnualFigures } from './xbrl';

/**
 * F-Score de Piotroski (1998) — 9 tests binaires, 0 a 9 points.
 *
 * Aucun test n'est pondere et aucune borne n'est a calibrer : c'est tout
 * l'interet de ce score face a un composite maison. Un test vaut 1 ou 0.
 *
 * DEUX ECARTS ASSUMES par rapport a la definition d'origine, chacun impose par
 * les donnees XBRL et documente ici plutot que tu :
 *
 * 1. Piotroski calcule le ROA sur le « resultat net avant elements
 *    exceptionnels ». Ce poste n'a pas de tag universel apres impot : les tags
 *    `IncomeLossFromContinuingOperations…` sont AVANT impot et different d'un
 *    emetteur a l'autre (Caterpillar n'utilise pas le meme qu'Apple). Les tests
 *    de ROA (1 et 3) reposent donc sur le **resultat operationnel**, disponible
 *    partout et insensible aux cessions d'activite.
 *
 * 2. En revanche le test d'accruals (4) conserve le **resultat net**, et ce
 *    n'est pas une incoherence : son role est precisement de reperer un
 *    benefice non adosse a de la tresorerie. Le passer au resultat operationnel
 *    lui ferait perdre son signal — chez Marvell, ou 69 % du resultat net 2026
 *    vient d'une cession, le test echoue avec le resultat net (CFO 1,75 Md$ <
 *    RN 2,67 Md$) et passerait a tort avec le resultat operationnel.
 *
 * Chaque test utilise donc la mesure de resultat adaptee a ce qu'il teste.
 */

export type PiotroskiTestId =
  | 'roa' | 'cfo' | 'deltaRoa' | 'accruals'
  | 'deltaLeverage' | 'deltaLiquidity' | 'dilution'
  | 'deltaMargin' | 'deltaTurnover';

export type PiotroskiCategory = 'rentabilite' | 'structure' | 'efficacite';

export interface PiotroskiTest {
  id: PiotroskiTestId;
  label: string;
  category: PiotroskiCategory;
  /** `null` = non calculable, a ne jamais confondre avec un echec. */
  passed: boolean | null;
  /** Grandeur mesuree, pour l'affichage du detail. */
  value: number | null;
}

export type PiotroskiVerdict = 'solide' | 'correct' | 'fragile' | 'difficulte';

export interface PiotroskiScore {
  periodEnd: string;
  tests: PiotroskiTest[];
  /** Points obtenus. A lire face a `available`, jamais sur 9 en aveugle. */
  score: number;
  available: number;
  missing: PiotroskiTestId[];
  /** `null` en dessous de MIN_AVAILABLE_TESTS : trop peu de tests pour conclure. */
  verdict: PiotroskiVerdict | null;
  /**
   * Part du resultat net qui ne vient pas de l'exploitation, `(RN - REX) / RN`.
   *
   * Negatif = cas normal, l'impot et les frais financiers rabotent le resultat
   * operationnel. **Positif = alerte** : le benefice est porte par du
   * hors-exploitation, typiquement une cession (Marvell 2026, +50 %).
   *
   * `null` sur un exercice deficitaire : le ratio y perd tout sens puisque le
   * denominateur passe par zero — Marvell 2023 sortait a -246 % avec un
   * resultat net de -163 M$ pour un resultat operationnel positif. Une perte se
   * voit deja dans le test 1, ce signal n'a rien a y ajouter.
   */
  nonOperatingShare: number | null;
}

/**
 * En dessous de ce nombre de tests calculables, aucun verdict global n'est
 * rendu. Rapporter un score sur trois observations serait creux : « 3/3 » ne
 * veut pas dire « excellent ».
 */
export const MIN_AVAILABLE_TESTS = 7;

export interface PiotroskiInput {
  current: AnnualFigures;
  previous: AnnualFigures;
  /**
   * Actif a la cloture t-2. Necessaire parce que Piotroski rapporte les flux de
   * l'exercice a l'actif d'OUVERTURE : le ROA de t-1 a donc besoin de l'actif
   * de t-2. Un F-Score complet reclame trois bilans consecutifs.
   */
  assetsBeforePrevious: number | null;
  /**
   * Variation relative du nombre d'actions, mesuree AU SEIN D'UN MEME DEPOT
   * (cf. `sharesChangeWithinFiling`). Ne jamais la recalculer en divisant deux
   * `dilutedShares` de la serie : les decomptes sont retraites des splits.
   */
  sharesChange: number | null;
}

/** Division protegee : `null` des qu'une entree manque ou que le denominateur est nul. */
function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / denominator;
}

function gt(a: number | null, b: number | null): boolean | null {
  if (a == null || b == null) return null;
  return a > b;
}

export function computePiotroski(input: PiotroskiInput): PiotroskiScore {
  const { current: c, previous: p, assetsBeforePrevious, sharesChange } = input;

  // Actif d'ouverture : celui de la cloture precedente.
  const openAssets = p.assets;
  const openAssetsPrev = assetsBeforePrevious;

  // ── Rentabilite ────────────────────────────────────────────────────────────
  const roa = ratio(c.operatingIncome, openAssets);
  const roaPrev = ratio(p.operatingIncome, openAssetsPrev);
  const cfoRatio = ratio(c.operatingCashFlow, openAssets);

  // ── Structure financiere ───────────────────────────────────────────────────
  const avgAssets = c.assets != null && p.assets != null ? (c.assets + p.assets) / 2 : null;
  const avgAssetsPrev =
    p.assets != null && openAssetsPrev != null ? (p.assets + openAssetsPrev) / 2 : null;
  const leverage = ratio(c.longTermDebt, avgAssets);
  const leveragePrev = ratio(p.longTermDebt, avgAssetsPrev);

  const liquidity = ratio(c.assetsCurrent, c.liabilitiesCurrent);
  const liquidityPrev = ratio(p.assetsCurrent, p.liabilitiesCurrent);

  // ── Efficacite operationnelle ──────────────────────────────────────────────
  const margin = ratio(c.grossProfit, c.revenue);
  const marginPrev = ratio(p.grossProfit, p.revenue);
  const turnover = ratio(c.revenue, openAssets);
  const turnoverPrev = ratio(p.revenue, openAssetsPrev);

  const tests: PiotroskiTest[] = [
    {
      id: 'roa', category: 'rentabilite',
      label: 'Rentabilité de l\'actif positive',
      passed: roa == null ? null : roa > 0,
      value: roa,
    },
    {
      id: 'cfo', category: 'rentabilite',
      label: 'Cash-flow d\'exploitation positif',
      passed: cfoRatio == null ? null : cfoRatio > 0,
      value: cfoRatio,
    },
    {
      id: 'deltaRoa', category: 'rentabilite',
      label: 'Rentabilité de l\'actif en hausse',
      passed: gt(roa, roaPrev),
      value: roa != null && roaPrev != null ? roa - roaPrev : null,
    },
    {
      id: 'accruals', category: 'rentabilite',
      // Volontairement sur le resultat NET : c'est le test qui doit reperer un
      // benefice non adosse a du cash.
      label: 'Bénéfice adossé à de la trésorerie',
      passed: gt(c.operatingCashFlow, c.netIncome),
      value:
        c.operatingCashFlow != null && c.netIncome != null && openAssets
          ? (c.operatingCashFlow - c.netIncome) / openAssets
          : null,
    },
    {
      id: 'deltaLeverage', category: 'structure',
      label: 'Levier long terme en baisse',
      passed: gt(leveragePrev, leverage),
      value: leverage != null && leveragePrev != null ? leverage - leveragePrev : null,
    },
    {
      id: 'deltaLiquidity', category: 'structure',
      label: 'Liquidité générale en hausse',
      passed: gt(liquidity, liquidityPrev),
      value: liquidity != null && liquidityPrev != null ? liquidity - liquidityPrev : null,
    },
    {
      id: 'dilution', category: 'structure',
      label: 'Aucune dilution des actionnaires',
      passed: sharesChange == null ? null : sharesChange <= 0,
      value: sharesChange,
    },
    {
      id: 'deltaMargin', category: 'efficacite',
      label: 'Marge brute en hausse',
      passed: gt(margin, marginPrev),
      value: margin != null && marginPrev != null ? margin - marginPrev : null,
    },
    {
      id: 'deltaTurnover', category: 'efficacite',
      label: 'Rotation de l\'actif en hausse',
      passed: gt(turnover, turnoverPrev),
      value: turnover != null && turnoverPrev != null ? turnover - turnoverPrev : null,
    },
  ];

  const available = tests.filter((t) => t.passed != null).length;
  const score = tests.filter((t) => t.passed === true).length;
  const missing = tests.filter((t) => t.passed == null).map((t) => t.id);

  // Denominateur borne a un resultat net strictement positif : voir la doc du
  // champ. Sur un exercice deficitaire le ratio diverge et n'apprend rien.
  const nonOperatingShare =
    c.netIncome != null && c.operatingIncome != null && c.netIncome > 0
      ? (c.netIncome - c.operatingIncome) / c.netIncome
      : null;

  return {
    periodEnd: c.periodEnd,
    tests, score, available, missing,
    verdict: verdictFor(score, available),
    nonOperatingShare,
  };
}

/**
 * Verdict rapporte au nombre de tests REELLEMENT calculables : un 6/7 ne se lit
 * pas comme un 6/9. En dessous du plancher, pas de verdict du tout — le detail
 * des tests reste affichable, mais aucune synthese ne serait honnete.
 */
export function verdictFor(score: number, available: number): PiotroskiVerdict | null {
  if (available < MIN_AVAILABLE_TESTS) return null;
  const r = score / available;
  if (r >= 8 / 9) return 'solide';
  if (r >= 5 / 9) return 'correct';
  if (r >= 2 / 9) return 'fragile';
  return 'difficulte';
}

/**
 * Applique le F-Score a toute une serie annuelle. Les deux premiers exercices
 * ne peuvent pas etre scores (il faut trois bilans consecutifs), ils sont donc
 * absents du resultat plutot que rendus avec des tests vides.
 *
 * `sharesChangeFor` est injecte pour garder ce module pur : c'est
 * `sharesChangeWithinFiling` qui sait lire les depots, pas le scoring.
 */
export function computePiotroskiSeries(
  series: AnnualFigures[],
  sharesChangeFor: (periodEnd: string, previousPeriodEnd: string) => number | null,
): PiotroskiScore[] {
  const out: PiotroskiScore[] = [];
  for (let i = 2; i < series.length; i++) {
    out.push(
      computePiotroski({
        current: series[i],
        previous: series[i - 1],
        assetsBeforePrevious: series[i - 2].assets,
        sharesChange: sharesChangeFor(series[i].periodEnd, series[i - 1].periodEnd),
      }),
    );
  }
  return out;
}
