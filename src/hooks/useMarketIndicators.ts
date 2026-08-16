import { useQuery } from '@tanstack/react-query';
import {
  fetchMarketIndicators, ALPHA_VANTAGE_API_KEY_SETTING, type MarketIndicators,
} from '../lib/api/alphavantage';
import { getCachedMarketIndicators, putCachedMarketIndicators, getSetting } from '../lib/db';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Meme cadence que le cache SEC (`TRUST_DAYS` de useFundamentals) : ce sont
 * des estimations consensus, pas un cours, elles ne bougent pas d'un jour a
 * l'autre. Le vrai contrainte est le plafond Alpha Vantage (25 requetes/jour),
 * pas la fraicheur de la donnee.
 */
const TRUST_DAYS = 7;

function ageInDays(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / DAY_MS : Number.POSITIVE_INFINITY;
}

export interface MarketIndicatorsState {
  data: MarketIndicators | null;
  /** Cle Alpha Vantage configuree dans les reglages. */
  enabled: boolean;
  /**
   * `data` vient d'un cache perime (>7 jours) faute de mieux : cle absente,
   * quota quotidien atteint, ou reseau indisponible. Ne jamais faire
   * disparaitre des indicateurs deja vus pour une panne temporaire.
   */
  stale: boolean;
}

export function useMarketIndicators(ticker: string | null) {
  return useQuery({
    queryKey: ['alphavantage', 'overview', ticker],
    enabled: Boolean(ticker),
    staleTime: DAY_MS,
    retry: false,
    queryFn: async (): Promise<MarketIndicatorsState> => {
      const symbol = ticker!.toUpperCase();
      const apiKey = await getSetting(ALPHA_VANTAGE_API_KEY_SETTING);
      const cached = await getCachedMarketIndicators(symbol);
      const cachedData = cached ? (JSON.parse(cached.payload) as MarketIndicators) : null;

      if (!apiKey) {
        return { data: cachedData, enabled: false, stale: cachedData != null };
      }

      if (cached && ageInDays(cached.fetchedAt) < TRUST_DAYS) {
        return { data: cachedData, enabled: true, stale: false };
      }

      const result = await fetchMarketIndicators(symbol, apiKey);
      if (result.kind === 'ok') {
        await putCachedMarketIndicators(symbol, JSON.stringify(result.data));
        return { data: result.data, enabled: true, stale: false };
      }

      // Quota atteint, ticker inconnu d'Alpha Vantage ou reseau en panne :
      // servir le cache perime plutot que de faire disparaitre le bloc.
      return { data: cachedData, enabled: true, stale: cachedData != null };
    },
  });
}
