import { useQuery } from '@tanstack/react-query';
import { fetchTop100Markets } from '../lib/api/coingecko';
import { rankScreener, computeStreaks, type ScreenerEntry } from '../lib/cryptoScreener';
import { insertScreenerLog, fetchScreenerLog } from '../lib/db';

const DAILY_TOP_N = 15;

export interface ScreenerEntryWithStreak extends ScreenerEntry {
  streak: number;
}

/**
 * Screener top 100 CoinGecko — un seul appel (`fetchTop100Markets`), classe
 * par score "chaud" experimental (`rankScreener`). Voir `lib/cryptoScreener.ts`
 * pour les limites du score : pas d'alignement macro par piece, pas encore
 * observe en conditions reelles.
 *
 * Le top 15 du jour est journalise (`screener_log`) pour calculer un streak —
 * un score instantane est du bruit, une piece qui reste plusieurs jours
 * consecutifs dans le haut du classement est un signal plus credible.
 */
export function useCryptoScreener() {
  return useQuery<ScreenerEntryWithStreak[]>({
    queryKey: ['crypto-screener-top100'],
    queryFn: async () => {
      const coins = await fetchTop100Markets();
      if (!coins) throw new Error('CoinGecko indisponible (quota ou réseau)');
      const ranked = rankScreener(coins);

      const today = new Date().toISOString().slice(0, 10);
      const dailyTop = ranked.slice(0, DAILY_TOP_N);
      await Promise.all(
        dailyTop.map((e, i) => insertScreenerLog(today, e.coin.id, e.coin.symbol, e.heat, i + 1))
      );

      const history = await fetchScreenerLog();
      const streaks = computeStreaks(history);

      return ranked.map((e) => ({ ...e, streak: streaks.get(e.coin.id) ?? 0 }));
    },
    staleTime: 15 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    retry: 1,
  });
}
