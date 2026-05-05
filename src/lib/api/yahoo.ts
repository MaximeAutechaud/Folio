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

// Returns EURUSD rate (1 EUR = X USD). Falls back to 1 on error.
export async function fetchEurUsd(): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=1d&range=1d`;
  try {
    const raw: string = await invoke('fetch_url', { url });
    const data = JSON.parse(raw);
    const rate = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof rate === 'number' ? rate : 1;
  } catch {
    return 1;
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
