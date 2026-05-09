import { invoke } from '@tauri-apps/api/core';

export interface CoinGeckoSuggestion {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank: number | null;
}

export async function searchCoinGecko(query: string): Promise<CoinGeckoSuggestion[]> {
  if (!query.trim()) return [];
  const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
  try {
    const raw: string = await invoke('fetch_url', { url });
    const data = JSON.parse(raw);
    return (data?.coins ?? []).slice(0, 8);
  } catch {
    return [];
  }
}

export async function fetchCryptoPrices(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};

  const joined = ids.map((id) => id.toLowerCase()).join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(joined)}&vs_currencies=usd`;

  const raw: string = await invoke('fetch_url', { url });
  const data: Record<string, { usd: number }> = JSON.parse(raw);

  return Object.fromEntries(
    Object.entries(data).map(([id, val]) => [id.toUpperCase(), val.usd])
  );
}

const COINGECKO_DAYS: Record<string, string> = {
  '1W': '7', '1M': '30', '3M': '90', '1Y': '365',
};

export async function fetchCryptoHistory(id: string, period: string): Promise<{ time: number; value: number }[]> {
  const days = COINGECKO_DAYS[period] ?? '30';
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`;
  const raw: string = await invoke('fetch_url', { url });
  const data = JSON.parse(raw);
  const prices: [number, number][] = data?.prices ?? [];
  return prices.map(([ts, price]) => ({ time: Math.floor(ts / 1000), value: price }));
}

// For known symbols → CoinGecko ID (fallback: use id directly)
const SYMBOL_TO_ID: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', AVAX: 'avalanche-2',
  DOT: 'polkadot', MATIC: 'matic-network', LINK: 'chainlink', LTC: 'litecoin',
  UNI: 'uniswap', ATOM: 'cosmos', XLM: 'stellar',
};

// ticker stored in DB is either a CoinGecko ID ("bitcoin") or a known symbol ("BTC")
export function symbolToId(ticker: string): string {
  return SYMBOL_TO_ID[ticker.toUpperCase()] ?? ticker.toLowerCase();
}
