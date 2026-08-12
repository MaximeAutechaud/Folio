import { useQuery } from '@tanstack/react-query';
import {
  fetchCompanyFacts,
  fetchCompanyProfile,
  fetchTickerDirectory,
  SEC_CONTACT_EMAIL_SETTING,
  type CompanyProfile,
} from '../lib/api/sec';
import {
  buildAnnualSeries, detectReporting, factNamespaces, sharesChangeWithinFiling,
  sharesOutstanding, type AnnualFigures, type Reporting,
} from '../lib/xbrl';
import { computePiotroskiSeries, type PiotroskiScore } from '../lib/piotroski';
import { computeAltman, type AltmanScore } from '../lib/altman';
import { computeContextIndicators, type ContextIndicators } from '../lib/contextIndicators';
import { isFinancialSic } from '../lib/sic';
import { fetchYahooPrices } from '../lib/api/yahoo';
import {
  countTickerDirectory, getCachedCompany, getSetting, lookupCik, putCachedCompany,
  replaceTickerDirectory, touchCachedCompany, SEC_DIRECTORY_FETCHED_AT,
} from '../lib/db';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Delai pendant lequel un snapshot est servi SANS aucun appel reseau. Les
 * comptes ne bougent qu'a chaque publication trimestrielle : re-verifier plus
 * souvent ne rapporterait rien.
 */
const TRUST_DAYS = 7;

/** Au-dela, l'annuaire est recharge — introductions et changements de ticker. */
const DIRECTORY_MAX_AGE_DAYS = 7;

/**
 * Rapports annuels des emetteurs etrangers, equivalents du 10-K. Leur presence
 * est le seul marqueur fiable d'une cotation par ADR : ni le profil ni les
 * comptes ne portent le rapport ADS/actions ordinaires.
 */
const FOREIGN_ANNUAL_FORMS = new Set(['20-F', '40-F']);

function ageInDays(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / DAY_MS : Number.POSITIVE_INFINITY;
}

export type FundamentalsError =
  | { kind: 'no_email' }
  | { kind: 'directory_failed' }
  | { kind: 'not_us_listed'; ticker: string }
  /**
   * Depose bien aupres de la SEC, mais aucune combinaison taxonomie/devise n'y
   * resout d'etats financiers. Depuis le support d'IFRS, ce n'est plus le cas
   * des emetteurs etrangers : il reste celui des vehicules sans exploitation
   * (ETF, fonds, fiducies) et des taxonomies non couvertes, d'ou le detail des
   * espaces de noms rencontres.
   */
  | { kind: 'no_financials'; name: string; namespaces: string[] }
  | { kind: 'fetch_failed'; step: 'profile' | 'facts' };

export class FundamentalsFailure extends Error {
  constructor(readonly detail: FundamentalsError) {
    super(detail.kind);
    this.name = 'FundamentalsFailure';
  }
}

/**
 * Ce qui est reellement mis en cache : quelques Ko, jamais les ~4 Mo bruts de
 * `companyfacts`.
 *
 * Les scores ne sont volontairement PAS stockes — ils sont recalcules a chaque
 * lecture depuis la serie. Une regle de scoring qui evolue doit s'appliquer
 * retroactivement, alors qu'un score fige survivrait a sa propre correction.
 *
 * `sharesChanges` est en revanche precalcule : la variation du nombre d'actions
 * se mesure au sein d'un meme depot et exige donc les faits bruts, qu'on ne
 * garde pas. La calculer a la volee obligerait a retelecharger 4 Mo.
 */
interface CachedPayload {
  profile: CompanyProfile;
  series: AnnualFigures[];
  sharesChanges: Record<string, number | null>;
  sharesOutstanding: number | null;
  /**
   * Absent des snapshots ecrits avant le support d'IFRS — tous en dollars par
   * construction, le resolver n'ayant alors rien su lire d'autre. D'ou le repli
   * sur `USD` a la lecture plutot qu'une invalidation du cache.
   */
  reporting?: Reporting;
}

export interface FundamentalsData {
  ticker: string;
  cik: string;
  profile: CompanyProfile;
  series: AnnualFigures[];

  /** Taxonomie et devise dans lesquelles les comptes ont ete lus. */
  reporting: Reporting;
  /**
   * Depose un 20-F ou un 40-F : la ligne cotee est un ADR, dont le rapport aux
   * actions ordinaires n'est publie nulle part chez la SEC. Verrouille tout
   * calcul de capitalisation, cf. `sharesOutstanding`.
   */
  isForeignIssuer: boolean;

  isFinancial: boolean;
  piotroski: PiotroskiScore[];
  altman: AltmanScore | null;
  context: ContextIndicators | null;
  marketCap: number | null;

  /** Date du dernier telechargement des comptes. */
  fetchedAt: string;
  /** `true` si les comptes viennent du cache, sans telechargement. */
  fromCache: boolean;
}

export function useSecContactEmail() {
  return useQuery({
    queryKey: ['setting', SEC_CONTACT_EMAIL_SETTING],
    queryFn: () => getSetting(SEC_CONTACT_EMAIL_SETTING),
    staleTime: 0,
  });
}

/**
 * Resout un ticker en CIK via l'annuaire local, en le rechargeant s'il est
 * absent ou perime. L'adresse de contact n'est donc exigee qu'au premier
 * chargement, pas a chaque recherche.
 */
async function resolveCik(symbol: string): Promise<string> {
  const cached = await lookupCik(symbol);
  const fetchedAt = await getSetting(SEC_DIRECTORY_FETCHED_AT);
  const stale = !fetchedAt || ageInDays(fetchedAt) > DIRECTORY_MAX_AGE_DAYS;
  const empty = (await countTickerDirectory()) === 0;

  if (cached && !stale) return cached;
  if (cached && stale) {
    // On tient un CIK utilisable : rafraichir est un confort, pas une
    // condition. Un annuaire perime ne doit pas bloquer une recherche qui
    // aboutit deja.
    void refreshDirectory().catch(() => undefined);
    return cached;
  }

  if (!stale && !empty) throw new FundamentalsFailure({ kind: 'not_us_listed', ticker: symbol });

  await refreshDirectory();
  const after = await lookupCik(symbol);
  if (!after) throw new FundamentalsFailure({ kind: 'not_us_listed', ticker: symbol });
  return after;
}

async function refreshDirectory(): Promise<void> {
  const email = await getSetting(SEC_CONTACT_EMAIL_SETTING);
  if (!email) throw new FundamentalsFailure({ kind: 'no_email' });

  const rows = await fetchTickerDirectory(email);
  if (!rows) throw new FundamentalsFailure({ kind: 'directory_failed' });
  await replaceTickerDirectory(rows);
}

/** Telecharge les comptes et en tire le snapshot normalise. */
async function buildPayload(cik: string, profile: CompanyProfile): Promise<CachedPayload> {
  const facts = await fetchCompanyFacts(cik);
  if (!facts) throw new FundamentalsFailure({ kind: 'fetch_failed', step: 'facts' });

  // Mesure une fois, transmise partout : deux appels a `detectReporting`
  // rendraient le meme resultat, mais la serie et la variation du nombre
  // d'actions doivent par construction parler de la meme taxonomie.
  const reporting = detectReporting(facts);
  const series = reporting ? buildAnnualSeries(facts, reporting) : [];
  if (series.length === 0) {
    throw new FundamentalsFailure({
      kind: 'no_financials',
      name: profile.name,
      namespaces: factNamespaces(facts),
    });
  }

  const sharesChanges: Record<string, number | null> = {};
  for (let i = 1; i < series.length; i++) {
    sharesChanges[series[i].periodEnd] =
      sharesChangeWithinFiling(facts, series[i].periodEnd, series[i - 1].periodEnd, reporting);
  }

  return {
    profile, series, sharesChanges,
    sharesOutstanding: sharesOutstanding(facts),
    reporting: reporting ?? undefined,
  };
}

export function useFundamentals(ticker: string | null) {
  const query = useQuery({
    queryKey: ['sec', 'fundamentals', ticker],
    enabled: Boolean(ticker),
    staleTime: DAY_MS,
    retry: false,
    queryFn: async (): Promise<FundamentalsData> => {
      const symbol = ticker!.toUpperCase();
      const cik = await resolveCik(symbol);
      const cached = await getCachedCompany(cik);

      let payload: CachedPayload;
      let fetchedAt: string;
      let fromCache: boolean;

      if (cached && ageInDays(cached.fetchedAt) < TRUST_DAYS) {
        // Dans le delai de confiance : aucun appel reseau du tout.
        payload = JSON.parse(cached.payload) as CachedPayload;
        fetchedAt = cached.fetchedAt;
        fromCache = true;
      } else {
        // `submissions` pese ~160 Ko contre ~4 Mo pour les comptes : on paie le
        // petit appel pour savoir s'il faut payer le gros.
        const profile = await fetchCompanyProfile(cik);
        if (!profile) throw new FundamentalsFailure({ kind: 'fetch_failed', step: 'profile' });

        const latestAccn = profile.lastAnnualReport?.accn ?? null;
        if (cached && latestAccn && cached.reportAccn === latestAccn) {
          await touchCachedCompany(cik);
          payload = JSON.parse(cached.payload) as CachedPayload;
          fetchedAt = new Date().toISOString();
          fromCache = true;
        } else {
          payload = await buildPayload(cik, profile);
          await putCachedCompany(cik, symbol, JSON.stringify(payload), latestAccn);
          fetchedAt = new Date().toISOString();
          fromCache = false;
        }
      }

      const { profile, series } = payload;

      const isFinancial = isFinancialSic(profile.sic);
      const isForeignIssuer = FOREIGN_ANNUAL_FORMS.has(profile.lastAnnualReport?.form ?? '');
      const last = series[series.length - 1] ?? null;

      let marketCap: number | null = null;
      if (!isFinancial && !isForeignIssuer && payload.sharesOutstanding != null) {
        const prices = await fetchYahooPrices([symbol]).catch(
          (): Record<string, number> => ({}),
        );
        const price = prices[symbol];
        if (typeof price === 'number') marketCap = payload.sharesOutstanding * price;
      }

      return {
        ticker: symbol, cik, profile, series,
        reporting: payload.reporting ?? { taxonomy: 'us-gaap', currency: 'USD' },
        isForeignIssuer,
        isFinancial,
        piotroski: isFinancial
          ? []
          : computePiotroskiSeries(series, (a) => payload.sharesChanges[a] ?? null),
        altman: isFinancial || !last ? null : computeAltman({ figures: last, marketCap }),
        context:
          isFinancial || !last ? null : computeContextIndicators({ figures: last, marketCap }),
        marketCap, fetchedAt, fromCache,
      };
    },
  });

  const failure: FundamentalsError | null =
    query.error instanceof FundamentalsFailure ? query.error.detail : null;

  return {
    data: query.data,
    failure,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
}
