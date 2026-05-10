import { invoke } from '@tauri-apps/api/core';

export interface YahooSuggestion {
  symbol: string;
  shortname: string;
  exchDisp: string;
  typeDisp: string;
}

// Detect currency from Yahoo ticker suffix
export function detectCurrency(ticker: string): string {
  const t = ticker.toUpperCase();
  if (/\.(PA|AS|BR|DE|MI|MC|HE|LS|ST|CO|OL|VI|SW|VX)$/.test(t)) return 'EUR';
  if (/\.(L|IL)$/.test(t)) return 'GBP';
  if (/\.(TO|V)$/.test(t)) return 'CAD';
  if (/\.AX$/.test(t)) return 'AUD';
  if (/\.T$/.test(t)) return 'JPY';
  if (/\.HK$/.test(t)) return 'HKD';
  return 'USD';
}

async function fetchSinglePrice(ticker: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  try {
    const raw: string = await invoke('fetch_url', { url });
    const data = JSON.parse(raw);
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === 'number' ? price : null;
  } catch {
    return null;
  }
}

export async function fetchYahooPrices(tickers: string[]): Promise<Record<string, number>> {
  if (tickers.length === 0) return {};
  const results = await Promise.all(
    tickers.map(async (ticker) => [ticker, await fetchSinglePrice(ticker)] as const)
  );
  return Object.fromEntries(results.filter(([, price]) => price != null)) as Record<string, number>;
}

// Returns EURUSD rate (1 EUR = X USD).
// Tries Yahoo Finance (query1 then query2), then falls back to Frankfurter (ECB data, no key).
export async function fetchEurUsd(): Promise<number> {
  const isValidRate = (r: unknown): r is number =>
    typeof r === 'number' && r > 0.5 && r < 3;

  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=1d&range=1d`;
      const raw: string = await invoke('fetch_url', { url });
      const data = JSON.parse(raw);
      const rate = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (isValidRate(rate)) return rate;
    } catch { /* try next source */ }
  }

  // Fallback: Frankfurter (open ECB-based exchange rate API, no key required)
  const raw: string = await invoke('fetch_url', { url: 'https://api.frankfurter.app/latest?from=EUR&to=USD' });
  const data = JSON.parse(raw);
  const rate = data?.rates?.USD;
  if (isValidRate(rate)) return rate;

  throw new Error('Could not fetch EUR/USD rate from any source');
}

const YAHOO_RANGE: Record<string, { range: string; interval: string }> = {
  '1W': { range: '5d',  interval: '1h' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '1Y': { range: '1y',  interval: '1wk' },
};

export async function fetchYahooHistory(ticker: string, period: string): Promise<{ time: number; value: number }[]> {
  const { range, interval } = YAHOO_RANGE[period] ?? YAHOO_RANGE['1M'];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
  const raw: string = await invoke('fetch_url', { url });
  const data = JSON.parse(raw);
  const result = data?.chart?.result?.[0];
  if (!result) return [];
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const points: { time: number; value: number }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) points.push({ time: timestamps[i], value: closes[i]! });
  }
  return points;
}

export async function fetchYahooDailyOHLCV(
  ticker: string
): Promise<{ date: string; close: number; volume: number }[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  try {
    const raw: string = await invoke('fetch_url', { url });
    const data = JSON.parse(raw);
    const result = data?.chart?.result?.[0];
    if (!result) return [];
    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const volumes: (number | null)[] = result.indicators?.quote?.[0]?.volume ?? [];
    const rows: { date: string; close: number; volume: number }[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
      rows.push({ date, close: closes[i]!, volume: volumes[i] ?? 0 });
    }
    return rows;
  } catch {
    return [];
  }
}

export async function searchYahoo(query: string): Promise<YahooSuggestion[]> {
  if (!query.trim()) return [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=7&newsCount=0&listsCount=0`;
  try {
    const raw: string = await invoke('fetch_url', { url });
    const data = JSON.parse(raw);
    return (data?.quotes ?? []).filter(
      (q: YahooSuggestion) => q.symbol && q.typeDisp !== 'Future'
    );
  } catch {
    return [];
  }
}
