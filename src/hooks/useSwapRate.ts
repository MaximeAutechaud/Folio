import { useQuery } from '@tanstack/react-query';
import { fetchCryptoPrices, symbolToId } from '../lib/api/coingecko';

export function useSwapRate(fromTicker: string, toTicker: string, enabled: boolean) {
  return useQuery({
    queryKey: ['swapRate', fromTicker, toTicker],
    queryFn: async () => {
      const fromId = symbolToId(fromTicker);
      const toId = symbolToId(toTicker);
      const prices = await fetchCryptoPrices([fromId, toId]);
      const fromPrice = prices[fromId.toUpperCase()];
      const toPrice = prices[toId.toUpperCase()];
      if (!fromPrice || !toPrice) return null;
      return fromPrice / toPrice;
    },
    enabled: enabled && fromTicker.length > 0 && toTicker.length > 0,
    staleTime: 30_000,
  });
}
