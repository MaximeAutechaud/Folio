import { useQuery } from '@tanstack/react-query';
import {
  fetchCompanyFacts,
  fetchCompanyProfile,
  fetchTickerDirectory,
  SEC_CONTACT_EMAIL_SETTING,
  type CompanyProfile,
} from '../lib/api/sec';
import {
  buildAnnualSeries, missingFields, reportingCurrency, sharesChangeWithinFiling,
  sharesOutstanding, type AnnualFigures,
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

function ageInDays(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / DAY_MS : Number.POSITIVE_INFINITY;
}

export type FundamentalsError =
  | { kind: 'no_email' }
  | { kind: 'directory_failed' }
  | { kind: 'not_us_listed'; ticker: string }
  /**
   * Depose bien aupres de la SEC, mais dans une monnaie que le resolver ne lit
   * pas — il interroge l'unite USD en dur. Cas des emetteurs etrangers cotes
   * aux Etats-Unis : ASML publie en EUR.
   */
  | { kind: 'unsupported_currency'; currency: string | null; name: string }
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
}

export interface FundamentalsData {
  ticker: string;
  cik: string;
  profile: CompanyProfile;
  series: AnnualFigures[];
  missing: Record<string, string[]>;

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

  const series = buildAnnualSeries(facts);
  if (series.length === 0) {
    throw new FundamentalsFailure({
      kind: 'unsupported_currency',
      currency: reportingCurrency(facts),
      name: profile.name,
    });
  }

  const sharesChanges: Record<string, number | null> = {};
  for (let i = 1; i < series.length; i++) {
    sharesChanges[series[i].periodEnd] =
      sharesChangeWithinFiling(facts, series[i].periodEnd, series[i - 1].periodEnd);
  }

  return { profile, series, sharesChanges, sharesOutstanding: sharesOutstanding(facts) };
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
      const missing: Record<string, string[]> = {};
      for (const row of series) {
        const m = missingFields(row);
        if (m.length > 0) missing[row.periodEnd] = m;
      }

      const isFinancial = isFinancialSic(profile.sic);
      const last = series[series.length - 1] ?? null;

      let marketCap: number | null = null;
      if (!isFinancial && payload.sharesOutstanding != null) {
        const prices = await fetchYahooPrices([symbol]).catch(
          (): Record<string, number> => ({}),
        );
        const price = prices[symbol];
        if (typeof price === 'number') marketCap = payload.sharesOutstanding * price;
      }

      return {
        ticker: symbol, cik, profile, series, missing,
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
