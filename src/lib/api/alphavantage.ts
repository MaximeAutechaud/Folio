import { invoke } from '@tauri-apps/api/core';

interface AV_TickerSentiment {
  ticker: string;
  relevance_score: string;
  ticker_sentiment_score: string;
}

interface AV_Article {
  overall_sentiment_score: number;
  ticker_sentiment: AV_TickerSentiment[];
}

interface AV_Response {
  feed?: AV_Article[];
  Note?: string;
  Information?: string;
}

function toAVTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').slice(0, 13) + '00';
}

export async function fetchAlphaVantageSentiment(
  ticker: string,
  apiKey: string
): Promise<{ volume7d: number; volumePrev: number; score: number; mainstream: boolean }> {
  const from = new Date(Date.now() - 7 * 86_400_000);
  const url = [
    'https://www.alphavantage.co/query',
    `?function=NEWS_SENTIMENT`,
    `&tickers=${encodeURIComponent(ticker)}`,
    `&time_from=${toAVTimestamp(from)}`,
    `&limit=200`,
    `&apikey=${apiKey}`,
  ].join('');

  try {
    const raw: string = await invoke('fetch_url', { url });
    const data = JSON.parse(raw) as AV_Response;

    if (data.Note || data.Information) {
      // Rate limit or API plan restriction — throw so caller skips upsert
      throw new Error(`AV rate limit: ${data.Note ?? data.Information}`);
    }

    if (!data.feed || data.feed.length === 0) {
      return { volume7d: 0, volumePrev: 0, score: 50, mainstream: false };
    }

    const volume7d = data.feed.length;
    const upperTicker = ticker.toUpperCase();

    const scores = data.feed.map(a => {
      const ts = a.ticker_sentiment?.find(t => t.ticker.toUpperCase() === upperTicker);
      const raw = ts ? parseFloat(ts.ticker_sentiment_score) : a.overall_sentiment_score;
      return isNaN(raw) ? null : raw;
    }).filter((s): s is number => s !== null);

    const avgSentiment = scores.length > 0
      ? scores.reduce((s, v) => s + v, 0) / scores.length
      : 0;

    // Normalize -1..+1 → 0..100
    const score = Math.round((avgSentiment + 1) / 2 * 100);

    // Mainstream: high article volume in 7 days (no prev-period comparison needed)
    const mainstream = volume7d >= 30;

    return { volume7d, volumePrev: 0, score, mainstream };
  } catch {
    return { volume7d: 0, volumePrev: 0, score: 50, mainstream: false };
  }
}
