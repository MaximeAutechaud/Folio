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
 * 5. Ni la taxonomie ni la devise ne sont donnees : il faut les deduire. Un
 *    emetteur etranger depose en `ifrs-full`, ou aucun nom de tag us-gaap
 *    n'existe, et souvent en plusieurs devises dont une seule porte la serie
 *    complete. Supposer `us-gaap` et `USD` rend une serie vide — cf.
 *    `detectReporting`.
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

  // ── Postes necessaires au scoring (Piotroski / Altman) ──
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
  stockholdersEquity: number | null;
  dilutedShares: number | null;

  // ── Postes de contexte (FCF, dette nette, DSO, rotation des stocks) ──
  // Hors score : leur absence est frequente et legitime — un editeur de
  // logiciels n'a pas de stocks — donc `missingFields` les ignore.
  cash: number | null;
  capex: number | null;
  receivables: number | null;
  inventory: number | null;
  /**
   * Charge d'interets — le meilleur indicateur de solvabilite quand il existe,
   * mais sa couverture est mauvaise et le restera : Apple s'arrete en 2023,
   * Caterpillar ne publie aucune des variantes courantes. A traiter comme
   * facultatif, jamais comme un pilier.
   */
  interestExpense: number | null;
}

/**
 * Postes sans lesquels un test de scoring devient incalculable. Sert a separer
 * « donnee manquante » de « poste sans objet » : un `inventory` a null chez un
 * editeur de logiciels n'est pas une lacune, un `assets` a null en est une.
 */
const CORE_FIELDS: readonly (keyof AnnualFigures)[] = [
  'revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'operatingCashFlow',
  'assets', 'assetsCurrent', 'liabilities', 'liabilitiesCurrent', 'longTermDebt',
  'retainedEarnings', 'stockholdersEquity', 'dilutedShares',
];

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

/** Postes resolus par chaine de tags. Meme jeu de cles dans chaque taxonomie. */
type ChainKey =
  | 'revenue' | 'costOfRevenue' | 'grossProfit' | 'operatingIncome' | 'netIncome'
  | 'operatingCashFlow' | 'dilutedShares' | 'assets' | 'assetsCurrent' | 'liabilities'
  | 'liabilitiesCurrent' | 'longTermDebt' | 'retainedEarnings' | 'stockholdersEquity'
  | 'cash' | 'capex' | 'receivables' | 'inventory' | 'interestExpense';

type ChainTable = Record<ChainKey, readonly string[]>;

const GAAP_CHAINS: ChainTable = {
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
  // La variante « y compris interets minoritaires » passe EN PREMIER, contre
  // l'intuition. Deux raisons, et elles vont dans le meme sens :
  //   - le passif se deduit par `actif - capitaux propres`, identite qui n'est
  //     vraie qu'avec les capitaux propres TOTAUX ; avec la seule part du
  //     groupe on surestime le passif du montant des minoritaires ;
  //   - X4 d'Altman mesure le coussin qui absorbe le passif, et les
  //     minoritaires en font partie.
  // Les societes sans minoritaires ne publient que le tag simple (AAPL, MSFT,
  // MRVL) et y retombent ; Caterpillar ne publie QUE la variante totale.
  stockholdersEquity: [
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    'StockholdersEquity',
  ],
  cash: [
    'CashAndCashEquivalentsAtCarryingValue',
    'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
  ],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  receivables: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'],
  inventory: ['InventoryNet'],
  interestExpense: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt'],
};

/**
 * Meme structure, taxonomie IFRS (`ifrs-full`). Les emetteurs etrangers cotes
 * aux Etats-Unis deposent bien aupres de la SEC, mais 12 des 15 ADR majeurs
 * sondes le font en IFRS : aucune chaine us-gaap ne matche, et la serie
 * ressortait silencieusement de longueur zero. Detail de la mesure dans
 * `docs/EMETTEURS-ETRANGERS.md`.
 *
 * Chaque tag ci-dessous a ete releve sur les comptes reels de Shell,
 * AstraZeneca, BP, TotalEnergies, Novartis, Rio Tinto, Infosys, SAP, Diageo,
 * TSMC, Novo Nordisk et Unilever — aucun n'est repris d'une lecture de la
 * taxonomie. Trois ecarts de couverture connus et assumes :
 *
 * - `GrossProfit` et `CostOfSales` sont absents chez les petrolieres et les
 *   minieres (SHEL, BP, TTE, RIO), qui ne presentent pas de marge brute.
 * - `ProfitLossFromOperatingActivities` manque chez Shell (jamais publie) et
 *   chez TotalEnergies depuis 2023. On ne se rabat PAS sur
 *   `ProfitLossBeforeTax` : melanger resultat d'exploitation et resultat avant
 *   impot au fil d'une meme serie ferait sauter le delta de ROA sur un simple
 *   changement de definition — le piege Caterpillar, applique au compte de
 *   resultat. Ces deux societes sortent donc a 6 tests sur 9, sans verdict.
 * - BP et TotalEnergies ne publient aucun decompte d'actions : le test de
 *   dilution y est non calculable, pas echoue.
 */
const IFRS_CHAINS: ChainTable = {
  revenue: ['Revenue', 'RevenueFromContractsWithCustomers', 'RevenueFromSaleOfGoods'],
  // `CostOfInventoriesRecognisedAsExpenseDuringPeriod` est une note (IAS 2.36d)
  // et non une ligne du compte de resultat, mais c'est la seule mesure de cout
  // des ventes de BP — dont l'etat de resultat s'arrete a « Purchases ». Chez
  // AstraZeneca et Novartis, qui publient les deux, les montants coincident.
  costOfRevenue: ['CostOfSales', 'CostOfInventoriesRecognisedAsExpenseDuringPeriod'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['ProfitLossFromOperatingActivities'],
  // `ProfitLoss` est le resultat de l'ensemble consolide, minoritaires compris —
  // meme perimetre que le flux de tresorerie auquel le test d'accruals le
  // compare, et que les capitaux propres retenus ci-dessous.
  netIncome: ['ProfitLoss'],
  operatingCashFlow: ['CashFlowsFromUsedInOperatingActivities'],
  // « Adjusted » designe l'ajustement de l'effet dilutif, pas un retraitement :
  // verifie sur les 10 societes qui publient les deux, la variante ajustee est
  // toujours la plus elevee.
  dilutedShares: ['AdjustedWeightedAverageShares', 'WeightedAverageShares'],
  assets: ['Assets'],
  assetsCurrent: ['CurrentAssets'],
  liabilities: ['Liabilities'],
  liabilitiesCurrent: ['CurrentLiabilities'],
  // `Borrowings` recouvre parfois l'endettement total, `LongtermBorrowings` sa
  // seule part non courante. Le melange serait un faux signal de levier s'il
  // survenait au milieu d'une serie ; mesure sur les 12, chaque societe s'en
  // tient au meme tag sur tous ses exercices, et le test de Piotroski compare
  // une societe a elle-meme.
  longTermDebt: ['LongtermBorrowings', 'Borrowings'],
  retainedEarnings: ['RetainedEarnings'],
  // `Equity` est le total, minoritaires inclus — l'equivalent IFRS exact de la
  // variante retenue en us-gaap, et la seule qui rende vraie l'identite
  // `passif = actif - capitaux propres` utilisee plus bas.
  stockholdersEquity: ['Equity'],
  cash: ['CashAndCashEquivalents'],
  capex: [
    'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
    'PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets',
  ],
  receivables: ['CurrentTradeReceivables', 'TradeAndOtherCurrentReceivables'],
  inventory: ['Inventories'],
  // `FinanceCosts` est le poste IFRS courant ; Shell et TotalEnergies ne
  // publient que `InterestExpense`.
  interestExpense: ['FinanceCosts', 'InterestExpense'],
};

/** Taxonomies couvertes, dans l'ordre de preference en cas d'egalite stricte. */
export const TAXONOMIES = ['us-gaap', 'ifrs-full'] as const;
export type Taxonomy = (typeof TAXONOMIES)[number];

const CHAINS: Record<Taxonomy, ChainTable> = {
  'us-gaap': GAAP_CHAINS,
  'ifrs-full': IFRS_CHAINS,
};

/** Postes de flux et de compte de resultat : dates par duree, pas par instant. */
const DURATION_KEYS = new Set<ChainKey>([
  'revenue', 'costOfRevenue', 'grossProfit', 'operatingIncome', 'netIncome',
  'operatingCashFlow', 'dilutedShares', 'capex', 'interestExpense',
]);

/** Les decomptes d'actions ne sont pas libelles dans une devise. */
const SHARE_KEYS = new Set<ChainKey>(['dilutedShares']);

/**
 * Taxonomie et devise dans lesquelles une societe est reellement lisible.
 *
 * Rien n'est devine : les deux sont **mesurees** sur les comptes, en comptant
 * les exercices que chaque combinaison permet de resoudre. C'est necessaire
 * parce qu'un meme depot melange les unites — un declarant IFRS publie souvent
 * en double devise, et le dollar n'y est pas forcement la serie complete. SAP
 * expose 11 exercices en euros et **un seul** en dollars ; Diageo 8 en livres
 * contre 4 en dollars. Choisir le dollar par principe donnerait une serie
 * tronquee, donc un F-Score sans historique.
 */
export interface Reporting {
  taxonomy: Taxonomy;
  /** Code d'unite XBRL, ex. `USD`, `EUR`, `TWD`. */
  currency: string;
}

/** Une unite monetaire, par opposition aux decomptes et aux ratios. */
function isMoneyUnit(unit: string): boolean {
  return unit !== 'shares' && unit !== 'pure' && !unit.includes('/');
}

/**
 * Postes dont la resolution mesure la completude d'un couple taxonomie/devise.
 * Les decomptes d'actions en sont exclus : ils sont dans la meme unite quelle
 * que soit la devise de publication, et ne departageraient donc rien.
 */
const COVERAGE_KEYS = CORE_FIELDS.filter((f) => f !== 'dilutedShares') as ChainKey[];

/** Postes ou aller chercher les devises candidates : presents chez tout le monde. */
const ANCHOR_KEYS: ChainKey[] = ['assets', 'revenue', 'netIncome', 'stockholdersEquity'];

function resolveChain(
  facts: CompanyFacts,
  reporting: Reporting,
  key: ChainKey,
): Map<string, XbrlPoint> {
  return resolveSeries(
    facts,
    reporting.taxonomy,
    CHAINS[reporting.taxonomy][key],
    SHARE_KEYS.has(key) ? 'shares' : reporting.currency,
    DURATION_KEYS.has(key) ? 'duration' : 'instant',
  );
}

/**
 * Ecart tolere entre la derniere cloture d'un candidat et la plus recente
 * trouvee, tous candidats confondus. Une combinaison qui accuse plus d'un
 * exercice de retard decrit un passe revolu et n'est plus candidate, quelle que
 * soit la longueur de son historique.
 */
const MAX_STALENESS_DAYS = 400;

interface Candidate extends Reporting {
  /** Nombre de couples (poste, exercice) resolus — la completude. */
  points: number;
  /** Derniere cloture couverte, ou `null` si la combinaison ne resout rien. */
  latestPeriodEnd: string | null;
}

function measure(facts: CompanyFacts, reporting: Reporting): Candidate {
  let points = 0;
  for (const key of COVERAGE_KEYS) points += resolveChain(facts, reporting, key).size;

  // La recence se lit sur les memes postes que les cloturees de la serie — le
  // compte de resultat, jamais le bilan : les etats intermediaires deposes en
  // cours d'annee y ajoutent des dates qui ne sont pas des fins d'exercice.
  let latestPeriodEnd: string | null = null;
  for (const key of ['revenue', 'netIncome'] as ChainKey[]) {
    for (const end of resolveChain(facts, reporting, key).keys()) {
      if (latestPeriodEnd == null || end > latestPeriodEnd) latestPeriodEnd = end;
    }
  }

  return { ...reporting, points, latestPeriodEnd };
}

/**
 * Determine comment lire une societe, ou `null` si aucune combinaison ne resout
 * quoi que ce soit — cas des ETF, fonds et fiducies, qui deposent d'autres
 * formulaires et n'ont pas d'etats financiers d'exploitation.
 *
 * **La recence prime sur la longueur de l'historique**, et l'ordre compte :
 * mesure sur comptes reels, trois societes changent de combinaison en cours de
 * route et l'ancienne serie est toujours la plus longue. Diageo publie en
 * livres jusqu'en 2023 puis en dollars ; Toyota et Sony passent de us-gaap a
 * IFRS en 2021. Maximiser la seule completude y elisait le present : le rapport
 * de Sony s'arretait a l'exercice 2021 sans que rien ne le signale, ce qui est
 * exactement le genre de donnee fausse qui ressemble a une donnee valide.
 */
export function detectReporting(facts: CompanyFacts): Reporting | null {
  const candidates: Candidate[] = [];

  for (const taxonomy of TAXONOMIES) {
    const units = new Set<string>();
    for (const key of ANCHOR_KEYS) {
      for (const tag of CHAINS[taxonomy][key]) {
        for (const unit of Object.keys(facts.facts?.[taxonomy]?.[tag]?.units ?? {})) {
          if (isMoneyUnit(unit)) units.add(unit);
        }
      }
    }
    for (const currency of units) {
      const candidate = measure(facts, { taxonomy, currency });
      if (candidate.points > 0 && candidate.latestPeriodEnd != null) candidates.push(candidate);
    }
  }

  if (candidates.length === 0) return null;

  const newest = candidates.reduce(
    (max, c) => (c.latestPeriodEnd! > max ? c.latestPeriodEnd! : max),
    candidates[0].latestPeriodEnd!,
  );
  const current = candidates.filter(
    (c) => (Date.parse(newest) - Date.parse(c.latestPeriodEnd!)) / DAY_MS <= MAX_STALENESS_DAYS,
  );

  // A recence comparable, la completude tranche : SAP publie 11 exercices en
  // euros et un seul en dollars, tous deux a jour — c'est l'euro qui porte
  // l'historique dont le F-Score a besoin.
  const best = current.reduce((a, b) => (b.points > a.points ? b : a));
  return { taxonomy: best.taxonomy, currency: best.currency };
}

/** Espaces de noms presents dans les comptes, du plus fourni au moins fourni. */
export function factNamespaces(facts: CompanyFacts): string[] {
  return Object.entries(facts.facts ?? {})
    .map(([ns, concepts]) => [ns, Object.keys(concepts).length] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([ns]) => ns);
}

/**
 * Construit la serie annuelle, du plus ancien au plus recent.
 *
 * Les dates de cloture viennent des faits de DUREE (compte de resultat) et non
 * d'un calendrier fiscal declare : c'est auto-coherent, et ca evite de dependre
 * de `submissions.fiscalYearEnd`, qui ne decrit que l'exercice courant alors
 * qu'une societe peut avoir change de date de cloture dans le passe.
 */
export function buildAnnualSeries(
  facts: CompanyFacts,
  reporting: Reporting | null = detectReporting(facts),
): AnnualFigures[] {
  if (!reporting) return [];
  const chain = (key: ChainKey) => resolveChain(facts, reporting, key);

  const revenue = chain('revenue');
  const costOfRevenue = chain('costOfRevenue');
  const grossProfit = chain('grossProfit');
  const operatingIncome = chain('operatingIncome');
  const netIncome = chain('netIncome');
  const operatingCashFlow = chain('operatingCashFlow');
  const dilutedShares = chain('dilutedShares');
  const capex = chain('capex');
  const interestExpense = chain('interestExpense');

  const assets = chain('assets');
  const assetsCurrent = chain('assetsCurrent');
  const liabilities = chain('liabilities');
  const liabilitiesCurrent = chain('liabilitiesCurrent');
  const longTermDebt = chain('longTermDebt');
  const retainedEarnings = chain('retainedEarnings');
  const equity = chain('stockholdersEquity');
  const cash = chain('cash');
  const receivables = chain('receivables');
  const inventory = chain('inventory');

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
      stockholdersEquity: eq,
      dilutedShares: val(dilutedShares),

      cash: val(cash),
      capex: val(capex),
      receivables: val(receivables),
      inventory: val(inventory),
      interestExpense: val(interestExpense),
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
  reporting: Reporting | null = detectReporting(facts),
): number | null {
  // Un decompte d'actions n'est libelle dans aucune devise : quand la detection
  // n'a rien tranche faute de poste monetaire, la taxonomie se retrouve seule
  // sur les tags d'actions plutot que de renoncer.
  const taxonomies = reporting ? [reporting.taxonomy] : TAXONOMIES;
  let pts: XbrlPoint[] = [];
  for (const taxonomy of taxonomies) {
    pts = resolveChainPoints(facts, taxonomy, CHAINS[taxonomy].dilutedShares, 'shares');
    if (pts.length > 0) break;
  }

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
 * Actions en circulation a la date de couverture du dernier depot, pour le
 * calcul de la capitalisation.
 *
 * Volontairement pris dans le namespace `dei` et non dans `dilutedShares` :
 * ce dernier est une moyenne ponderee SUR l'exercice, ce qui n'a pas de sens
 * multiplie par un cours du jour.
 *
 * **Ne convient qu'aux societes americaines.** Chez un emetteur etranger, ce
 * decompte porte les actions ordinaires alors que le cours Yahoo porte l'ADS,
 * qui en represente souvent plusieurs — et le rapport n'est publie nulle part
 * dans les donnees SEC. Mesure sur 9 ADR : exact chez SAP, Novartis, Unilever
 * (1 pour 1), mais 2x trop haut chez Shell, 4x chez Diageo et 10x chez TSMC,
 * ou le produit donne 11 000 Md$ de capitalisation. L'appelant doit donc
 * s'appuyer sur le formulaire annuel (10-K contre 20-F/40-F) avant d'en tirer
 * une capitalisation.
 */
export function sharesOutstanding(facts: CompanyFacts): number | null {
  const pts = facts.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares;
  if (!Array.isArray(pts) || pts.length === 0) return null;
  const latest = [...pts].sort((a, b) => a.end.localeCompare(b.end))[pts.length - 1];
  return typeof latest?.val === 'number' ? latest.val : null;
}

/**
 * Postes de scoring non resolus d'un exercice. Sert a distinguer "test echoue"
 * de "test non calculable" : un score degrade ne doit jamais avoir l'air normal.
 *
 * Ne considere que `CORE_FIELDS` : les postes de contexte (tresorerie, capex,
 * creances, stocks) sont souvent absents pour de bonnes raisons et les inclure
 * ferait passer pour lacunaire une societe qui n'a simplement pas de stocks.
 */
export function missingFields(row: AnnualFigures): string[] {
  return CORE_FIELDS.filter((k) => row[k] == null);
}
