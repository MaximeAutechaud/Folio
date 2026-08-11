import { useQuery } from '@tanstack/react-query';
import {
  fetchCompanyFacts,
  fetchCompanyProfile,
  fetchTickerDirectory,
  SEC_CONTACT_EMAIL_SETTING,
  type CikEntry,
  type CompanyProfile,
} from '../lib/api/sec';
import { buildAnnualSeries, missingFields, type AnnualFigures } from '../lib/xbrl';
import { getSetting } from '../lib/db';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Motifs d'echec distingues explicitement : un ticker hors perimetre americain
 * n'est pas une panne, et ne doit surtout pas s'afficher comme telle. La SEC ne
 * couvre que les societes cotees aux Etats-Unis.
 */
export type FundamentalsError =
  | { kind: 'no_email' }
  | { kind: 'directory_failed' }
  | { kind: 'not_us_listed'; ticker: string }
  | { kind: 'fetch_failed'; step: 'profile' | 'facts' };

export class FundamentalsFailure extends Error {
  constructor(readonly detail: FundamentalsError) {
    super(detail.kind);
    this.name = 'FundamentalsFailure';
  }
}

export interface FundamentalsData {
  ticker: string;
  cik: string;
  profile: CompanyProfile;
  series: AnnualFigures[];
  /** Postes non resolus, par exercice — seulement ceux qui en ont. */
  missing: Record<string, string[]>;
}

/** Adresse de contact SEC, saisie dans les reglages. */
export function useSecContactEmail() {
  return useQuery({
    queryKey: ['setting', SEC_CONTACT_EMAIL_SETTING],
    queryFn: () => getSetting(SEC_CONTACT_EMAIL_SETTING),
    staleTime: 0,
  });
}

/**
 * Annuaire ticker -> CIK. ~800 Ko, il ne bouge qu'a la marge : on le garde une
 * semaine plutot que de le rappeler a chaque recherche.
 */
export function useSecDirectory(email: string | null | undefined) {
  return useQuery({
    queryKey: ['sec', 'directory'],
    enabled: Boolean(email),
    staleTime: 7 * DAY,
    gcTime: 7 * DAY,
    queryFn: async (): Promise<CikEntry[]> => {
      const rows = await fetchTickerDirectory(email!);
      if (!rows) throw new FundamentalsFailure({ kind: 'directory_failed' });
      return rows;
    },
  });
}

/**
 * Fondamentaux d'une societe. `staleTime` d'un jour : les comptes ne bougent
 * qu'a chaque publication trimestrielle, rien ne justifie de retelecharger les
 * ~4 Mo de `companyfacts` plus souvent.
 */
export function useFundamentals(ticker: string | null) {
  const { data: email, isLoading: emailLoading } = useSecContactEmail();
  const directory = useSecDirectory(email);

  const query = useQuery({
    queryKey: ['sec', 'fundamentals', ticker],
    enabled: Boolean(ticker) && Boolean(directory.data),
    staleTime: DAY,
    retry: false,
    queryFn: async (): Promise<FundamentalsData> => {
      const symbol = ticker!.toUpperCase();
      const entry = directory.data!.find((e) => e.ticker === symbol);
      if (!entry) throw new FundamentalsFailure({ kind: 'not_us_listed', ticker: symbol });

      const [profile, facts] = await Promise.all([
        fetchCompanyProfile(entry.cik),
        fetchCompanyFacts(entry.cik),
      ]);
      if (!profile) throw new FundamentalsFailure({ kind: 'fetch_failed', step: 'profile' });
      if (!facts) throw new FundamentalsFailure({ kind: 'fetch_failed', step: 'facts' });

      const series = buildAnnualSeries(facts);
      const missing: Record<string, string[]> = {};
      for (const row of series) {
        const m = missingFields(row);
        if (m.length > 0) missing[row.periodEnd] = m;
      }

      return { ticker: symbol, cik: entry.cik, profile, series, missing };
    },
  });

  const failure: FundamentalsError | null =
    !emailLoading && !email
      ? { kind: 'no_email' }
      : directory.error instanceof FundamentalsFailure
        ? directory.error.detail
        : query.error instanceof FundamentalsFailure
          ? query.error.detail
          : null;

  return {
    data: query.data,
    failure,
    isLoading: emailLoading || directory.isLoading || query.isLoading,
    isFetching: directory.isFetching || query.isFetching,
  };
}
