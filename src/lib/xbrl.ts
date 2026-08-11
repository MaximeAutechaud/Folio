/**
 * Reduction des donnees XBRL de la SEC (`/api/xbrl/companyfacts`) en series
 * annuelles exploitables.
 *
 * Cette couche existe parce que le format brut est piege a quatre endroits, et
 * qu'aucun de ces pieges ne leve d'erreur — ils rendent des donnees fausses qui
 * ressemblent a des donnees valides :
 *
 * 1. `fy` / `fp` decrivent le DEPOT, pas la periode du fait. Un 10-K depose en
 *    2025 porte les exercices 2023, 2024 et 2025, tous estampilles `fy: 2025`.
 *    On date donc chaque fait par `start`/`end`, jamais par `fy`.
 * 2. Les faits de duree melangent trimestres (~91 j), cumuls YTD (~273 j) et
 *    exercices (~365 j) dans le meme tableau. Sans filtre sur la duree, on
 *    additionne des choux et des carottes.
 * 3. Le meme exercice est republie a chaque depot ulterieur (comparatifs,
 *    retraitements). On garde le depot le plus recent : c'est celui qui porte
 *    les corrections.
 * 4. Un poste comptable n'a pas UN tag mais une succession de tags dans le
 *    temps. Le chiffre d'affaires d'Apple bascule de `SalesRevenueNet` vers
 *    `RevenueFromContractWithCustomerExcludingAssessedTax` en 2018 (norme
 *    ASC 606) : lire le seul tag `Revenues` renvoie une serie qui s'arrete en
 *    2018, sans le moindre signal d'erreur.
 */

export interface XbrlPoint {
  /** Absent sur un fait instantane (poste de bilan). */
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  frame?: string;
}

interface XbrlConcept {
  label?: string;
  units: Record<string, XbrlPoint[]>;
}

export interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, XbrlConcept>>;
}

/** Un exercice comptable, normalise. `null` = poste non resolu (cf. `missingFields`). */
export interface AnnualFigures {
  /** Date de cloture de l'exercice, ex. `2025-09-27`. */
  periodEnd: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  assets: number | null;
  assetsCurrent: number | null;
  liabilities: number | null;
  liabilitiesCurrent: number | null;
  longTermDebt: number | null;
  retainedEarnings: number | null;
  dilutedShares: number | null;
}

const DAY_MS = 86_400_000;

/** Fenetre de tolerance autour d'un exercice : les cloturees "52/53 semaines" ne tombent pas sur 365 j pile. */
const ANNUAL_MIN_DAYS = 350;
const ANNUAL_MAX_DAYS = 380;

export function durationDays(p: XbrlPoint): number | null {
  if (!p.start) return null;
  return (Date.parse(p.end) - Date.parse(p.start)) / DAY_MS;
}

/**
 * Faits de duree ramenes aux seules periodes annuelles, un point par cloture.
 * En cas de republication du meme exercice, le depot le plus recent gagne.
 */
export function collectAnnualDurations(points: XbrlPoint[]): Map<string, XbrlPoint> {
  const out = new Map<string, XbrlPoint>();
  for (const p of points) {
    const dur = durationDays(p);
    if (dur == null || dur < ANNUAL_MIN_DAYS || dur > ANNUAL_MAX_DAYS) continue;
    const prev = out.get(p.end);
    if (!prev || p.filed > prev.filed) out.set(p.end, p);
  }
  return out;
}

/**
 * Faits instantanes (postes de bilan) indexes par date, meme regle de
 * republication. Aucun filtre de duree : un instantane n'en a pas.
 */
export function collectInstants(points: XbrlPoint[]): Map<string, XbrlPoint> {
  const out = new Map<string, XbrlPoint>();
  for (const p of points) {
    if (p.start) continue;
    const prev = out.get(p.end);
    if (!prev || p.filed > prev.filed) out.set(p.end, p);
  }
  return out;
}

function conceptPoints(
  facts: CompanyFacts,
  ns: string,
  tag: string,
  unit: string,
): XbrlPoint[] | null {
  const pts = facts.facts?.[ns]?.[tag]?.units?.[unit];
  return Array.isArray(pts) && pts.length > 0 ? pts : null;
}

/** Tous les points d'une chaine, sans arbitrage. Reserve aux traitements qui ont besoin du brut. */
export function resolveChainPoints(
  facts: CompanyFacts,
  ns: string,
  tags: readonly string[],
  unit: string,
): XbrlPoint[] {
  const merged: XbrlPoint[] = [];
  for (const tag of tags) {
    const pts = conceptPoints(facts, ns, tag, unit);
    if (pts) merged.push(...pts);
  }
  return merged;
}

/**
 * Resout une chaine de tags en une serie par date de cloture, **dans l'ordre de
 * priorite de la chaine** : pour une periode donnee, le premier tag qui fournit
 * une valeur gagne. Les tags suivants ne servent qu'a combler les periodes
 * laissees vides.
 *
 * Ne surtout pas fusionner les tags avant d'arbitrer : deux tags d'un meme
 * poste se chevauchent souvent, et departager au depot le plus recent revient a
 * choisir au hasard entre un total et une de ses composantes. Chez Caterpillar
 * en 2024, `CostOfGoodsAndServicesSold` vaut ~0 alors que `CostOfRevenue` vaut
 * 40,2 Md$ : l'arbitrage par date donnait une marge brute de ~100 %.
 *
 * L'arbitrage entre republications d'un MEME tag (retraitements) reste au depot
 * le plus recent — c'est le role de `collectAnnualDurations` / `collectInstants`.
 */
function resolveSeries(
  facts: CompanyFacts,
  ns: string,
  tags: readonly string[],
  unit: string,
  kind: 'duration' | 'instant',
): Map<string, XbrlPoint> {
  const out = new Map<string, XbrlPoint>();
  for (const tag of tags) {
    const pts = conceptPoints(facts, ns, tag, unit);
    if (!pts) continue;
    const resolved = kind === 'duration' ? collectAnnualDurations(pts) : collectInstants(pts);
    for (const [end, p] of resolved) {
      if (!out.has(end)) out.set(end, p);
    }
  }
  return out;
}

// ── Chaines de repli par poste ────────────────────────────────────────────────
// Ordre : tag courant d'abord, tags historiques ensuite. Les series sont
// fusionnees puis dedoublonnees par date de cloture, ce qui recolle de lui-meme
// le raccord ASC 606 de 2018 sans traitement special.

const CHAINS = {
  revenue: [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'Revenues',
    'SalesRevenueNet',
  ],
  // `CostOfRevenue` est le TOTAL dans la taxonomie US-GAAP ; les deux suivants
  // n'en sont que des composantes, et servent aux emetteurs (Apple) qui ne
  // publient pas le total. L'ordre inverse donnait la marge brute de Caterpillar.
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  operatingCashFlow: [
    'NetCashProvidedByUsedInOperatingActivities',
    'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
  ],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
  assets: ['Assets'],
  assetsCurrent: ['AssetsCurrent'],
  liabilities: ['Liabilities'],
  liabilitiesCurrent: ['LiabilitiesCurrent'],
  longTermDebt: ['LongTermDebtNoncurrent', 'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations'],
  retainedEarnings: ['RetainedEarningsAccumulatedDeficit'],
  stockholdersEquity: ['StockholdersEquity'],
} as const;

const GAAP = 'us-gaap';

function annualMap(facts: CompanyFacts, tags: readonly string[], unit = 'USD') {
  return resolveSeries(facts, GAAP, tags, unit, 'duration');
}

function instantMap(facts: CompanyFacts, tags: readonly string[], unit = 'USD') {
  return resolveSeries(facts, GAAP, tags, unit, 'instant');
}

/**
 * Construit la serie annuelle, du plus ancien au plus recent.
 *
 * Les dates de cloture viennent des faits de DUREE (compte de resultat) et non
 * d'un calendrier fiscal declare : c'est auto-coherent, et ca evite de dependre
 * de `submissions.fiscalYearEnd`, qui ne decrit que l'exercice courant alors
 * qu'une societe peut avoir change de date de cloture dans le passe.
 */
export function buildAnnualSeries(facts: CompanyFacts): AnnualFigures[] {
  const revenue = annualMap(facts, CHAINS.revenue);
  const costOfRevenue = annualMap(facts, CHAINS.costOfRevenue);
  const grossProfit = annualMap(facts, CHAINS.grossProfit);
  const operatingIncome = annualMap(facts, CHAINS.operatingIncome);
  const netIncome = annualMap(facts, CHAINS.netIncome);
  const operatingCashFlow = annualMap(facts, CHAINS.operatingCashFlow);
  const dilutedShares = annualMap(facts, CHAINS.dilutedShares, 'shares');

  const assets = instantMap(facts, CHAINS.assets);
  const assetsCurrent = instantMap(facts, CHAINS.assetsCurrent);
  const liabilities = instantMap(facts, CHAINS.liabilities);
  const liabilitiesCurrent = instantMap(facts, CHAINS.liabilitiesCurrent);
  const longTermDebt = instantMap(facts, CHAINS.longTermDebt);
  const retainedEarnings = instantMap(facts, CHAINS.retainedEarnings);
  const equity = instantMap(facts, CHAINS.stockholdersEquity);

  // Les cloturees d'exercice sont celles du compte de resultat : un poste de
  // bilan isole (publie chaque trimestre) ne cree pas un exercice a lui seul.
  const periodEnds = [...new Set([...revenue.keys(), ...netIncome.keys()])].sort();

  return periodEnds.map((periodEnd) => {
    const val = (m: Map<string, XbrlPoint>) => m.get(periodEnd)?.val ?? null;

    const rev = val(revenue);
    const cost = val(costOfRevenue);
    const gp = val(grossProfit);
    const totalAssets = val(assets);
    const eq = val(equity);
    const liab = val(liabilities);

    return {
      periodEnd,
      revenue: rev,
      // Beaucoup de societes ne publient pas GrossProfit et laissent deduire.
      grossProfit: gp ?? (rev != null && cost != null ? rev - cost : null),
      operatingIncome: val(operatingIncome),
      netIncome: val(netIncome),
      operatingCashFlow: val(operatingCashFlow),
      assets: totalAssets,
      assetsCurrent: val(assetsCurrent),
      // Idem : total du passif souvent absent, mais deductible du bilan.
      liabilities: liab ?? (totalAssets != null && eq != null ? totalAssets - eq : null),
      liabilitiesCurrent: val(liabilitiesCurrent),
      longTermDebt: val(longTermDebt),
      retainedEarnings: val(retainedEarnings),
      dilutedShares: val(dilutedShares),
    };
  });
}

/**
 * Variation relative du nombre d'actions entre deux exercices, mesuree **au
 * sein d'un meme depot**. Retourne `null` si aucun depot ne couvre les deux.
 *
 * Ne jamais comparer deux `dilutedShares` de `buildAnnualSeries` directement :
 * les decomptes d'actions sont retroactivement retraites des splits, mais
 * seulement dans les depots publies APRES le split. Un 10-K ne portant que
 * trois exercices de comparatifs, un exercice ancien reste fige en base
 * pre-split pendant que son voisin, republie plus tard, passe en base ajustee.
 * Chez Apple la serie saute ainsi de 5,25 Md d'actions (2017, base d'origine) a
 * 20,0 Md (2018, ajuste du split 4:1 de 2020) : une dilution de 280 % qui n'a
 * jamais eu lieu. Les montants monetaires, eux, ne sont pas retraites — ce
 * piege ne concerne que les decomptes d'actions.
 */
export function sharesChangeWithinFiling(
  facts: CompanyFacts,
  periodEnd: string,
  prevPeriodEnd: string,
): number | null {
  const pts = resolveChainPoints(facts, GAAP, CHAINS.dilutedShares, 'shares');

  // Regroupe par depot : un accession number = une base de split homogene.
  const byAccn = new Map<string, Map<string, XbrlPoint>>();
  for (const p of pts) {
    const dur = durationDays(p);
    if (dur == null || dur < ANNUAL_MIN_DAYS || dur > ANNUAL_MAX_DAYS) continue;
    if (p.end !== periodEnd && p.end !== prevPeriodEnd) continue;
    if (!byAccn.has(p.accn)) byAccn.set(p.accn, new Map());
    byAccn.get(p.accn)!.set(p.end, p);
  }

  const candidates = [...byAccn.values()]
    .filter((m) => m.has(periodEnd) && m.has(prevPeriodEnd))
    // Le depot le plus recent porte les retraitements les plus a jour.
    .sort((a, b) => b.get(periodEnd)!.filed.localeCompare(a.get(periodEnd)!.filed));

  if (candidates.length === 0) return null;

  const cur = candidates[0].get(periodEnd)!.val;
  const prev = candidates[0].get(prevPeriodEnd)!.val;
  if (prev === 0) return null;
  return (cur - prev) / prev;
}

/**
 * Postes non resolus d'un exercice. Sert a distinguer "test echoue" de "test
 * non calculable" : un score degrade ne doit jamais avoir l'air normal.
 */
export function missingFields(row: AnnualFigures): string[] {
  return Object.entries(row)
    .filter(([k, v]) => k !== 'periodEnd' && v == null)
    .map(([k]) => k);
}
