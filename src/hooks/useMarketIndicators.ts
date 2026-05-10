import { useQuery } from '@tanstack/react-query';
import { fetchAllNarrativeTickers, fetchNarratives, fetchStoredPriceHistory, getLastPriceDate, upsertPriceHistory } from '../lib/db';
import { fetchYahooDailyOHLCV } from '../lib/api/yahoo';
import { computeIndicators, type TickerIndicators } from '../lib/indicators';

const BATCH_SIZE = 5;

export function useMarketIndicators() {
  return useQuery({
    queryKey: ['market-indicators'],
    queryFn: async (): Promise<Record<string, TickerIndicators>> => {
      const [allTickers, narratives] = await Promise.all([fetchAllNarrativeTickers(), fetchNarratives()]);
      const etfTickers = narratives.map(n => n.ref_etf).filter((t): t is string => !!t);
      const uniqueTickers = [...new Set([...allTickers.map(t => t.ticker), ...etfTickers])];
      if (uniqueTickers.length === 0) return {};

      const today = new Date().toISOString().split('T')[0];

      // Find tickers without up-to-date data
      const stale: string[] = [];
      for (const ticker of uniqueTickers) {
        const last = await getLastPriceDate(ticker);
        if (last !== today) stale.push(ticker);
      }

      // Fetch in batches to avoid rate limiting
      for (let i = 0; i < stale.length; i += BATCH_SIZE) {
        await Promise.allSettled(
          stale.slice(i, i + BATCH_SIZE).map(async ticker => {
            const rows = await fetchYahooDailyOHLCV(ticker);
            if (rows.length > 0) await upsertPriceHistory(ticker, rows);
          })
        );
      }

      // Calculate indicators from stored data
      const result: Record<string, TickerIndicators> = {};
      await Promise.all(
        uniqueTickers.map(async ticker => {
          const data = await fetchStoredPriceHistory(ticker, 250);
          result[ticker] = computeIndicators(data);
        })
      );

      return result;
    },
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
  });
}
