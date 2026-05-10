import { useQuery } from '@tanstack/react-query';
import {
  fetchNarratives, fetchAllNarrativeTickers,
  fetchLatestFundamentals, getLastFundamentalsDate,
  upsertFundamentals, getSetting,
  type FundamentalsRecord,
} from '../lib/db';
import { fetchFinnhubRecommendation } from '../lib/api/finnhub';

export type { FundamentalsRecord };

const BATCH_SIZE = 4;

export function useFundamentals() {
  return useQuery({
    queryKey: ['fundamentals'],
    queryFn: async (): Promise<Record<number, FundamentalsRecord>> => {
      const apiKey = await getSetting('finnhub_key');
      if (!apiKey) return {};

      const [narratives, allTickers] = await Promise.all([fetchNarratives(), fetchAllNarrativeTickers()]);

      const tickersByNarrative = allTickers.reduce<Record<number, string[]>>((acc, t) => {
        if (!acc[t.narrative_id]) acc[t.narrative_id] = [];
        acc[t.narrative_id].push(t.ticker);
        return acc;
      }, {});

      const today = new Date().toISOString().split('T')[0];

      for (const n of narratives) {
        const tickers = tickersByNarrative[n.id] ?? [];
        if (tickers.length === 0) continue;

        const last = await getLastFundamentalsDate(n.id);
        if (last === today) continue;

        const allData = [];
        for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
          const batch = await Promise.allSettled(
            tickers.slice(i, i + BATCH_SIZE).map(t => fetchFinnhubRecommendation(t, apiKey))
          );
          for (const r of batch) {
            if (r.status === 'fulfilled') allData.push(r.value);
          }
        }

        const means = allData
          .map(d => d.recommendationMean)
          .filter((m): m is number => m !== null);

        if (means.length === 0) continue;

        const avgMean = means.reduce((s, v) => s + v, 0) / means.length;
        const score = Math.round(Math.max(0, Math.min(100, (5 - avgMean) / 4 * 100)));

        await upsertFundamentals(n.id, today, {
          score,
          recommendationMean: parseFloat(avgMean.toFixed(2)),
          buyCount:  allData.reduce((s, d) => s + d.buyCount,  0),
          holdCount: allData.reduce((s, d) => s + d.holdCount, 0),
          sellCount: allData.reduce((s, d) => s + d.sellCount, 0),
        });
      }

      const result: Record<number, FundamentalsRecord> = {};
      for (const n of narratives) {
        const record = await fetchLatestFundamentals(n.id);
        if (record) result[n.id] = record;
      }
      return result;
    },
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
  });
}
