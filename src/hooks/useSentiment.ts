import { useQuery } from '@tanstack/react-query';
import {
  fetchNarratives, fetchAllNarrativeTickers,
  fetchLatestSentiment, getLastSentimentDate,
  upsertSentiment, getSetting,
  type SentimentRecord,
} from '../lib/db';
import { fetchAlphaVantageSentiment } from '../lib/api/alphavantage';

export type { SentimentRecord };

export function useSentiment() {
  return useQuery({
    queryKey: ['sentiment'],
    queryFn: async (): Promise<Record<number, SentimentRecord>> => {
      const apiKey = await getSetting('alphavantage_key');
      if (!apiKey) return {};

      const [narratives, allTickers] = await Promise.all([fetchNarratives(), fetchAllNarrativeTickers()]);

      // Primary ticker per narrative: ref_etf first, else first configured ticker
      const firstTickerByNarrative = allTickers.reduce<Record<number, string>>((acc, t) => {
        if (!acc[t.narrative_id]) acc[t.narrative_id] = t.ticker;
        return acc;
      }, {});

      const today = new Date().toISOString().split('T')[0];

      let callCount = 0;
      for (const n of narratives) {
        const primaryTicker = n.ref_etf || firstTickerByNarrative[n.id];
        if (!primaryTicker) continue;

        const last = await getLastSentimentDate(n.id);
        if (last === today) continue;

        // Free tier: 5 calls/min — wait 13s between calls to stay under limit
        if (callCount > 0) await new Promise(r => setTimeout(r, 13_000));
        callCount++;

        try {
          const data = await fetchAlphaVantageSentiment(primaryTicker, apiKey);
          if (data.volume7d > 0) await upsertSentiment(n.id, today, data);
        } catch {
          // Non-blocking — narrative skipped if Alpha Vantage fails or rate limited
        }
      }

      const result: Record<number, SentimentRecord> = {};
      for (const n of narratives) {
        const record = await fetchLatestSentiment(n.id);
        if (record && record.volume_7d > 0) result[n.id] = record;
      }
      return result;
    },
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
  });
}
