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

export interface CryptoHistoryPoint {
  time: number;
  value: number;
  marketCap: number | null;
  volume: number | null;
}

export async function fetchCryptoHistory(id: string, period: string): Promise<CryptoHistoryPoint[]> {
  const days = COINGECKO_DAYS[period] ?? '30';
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`;
  const raw: string = await invoke('fetch_url', { url });
  const data = JSON.parse(raw);
  const prices: [number, number][] = data?.prices ?? [];
  const marketCaps: [number, number][] = data?.market_caps ?? [];
  const volumes: [number, number][] = data?.total_volumes ?? [];
  const mcapByTs = new Map(marketCaps.map(([ts, mc]) => [Math.floor(ts / 1000), mc]));
  const volByTs = new Map(volumes.map(([ts, v]) => [Math.floor(ts / 1000), v]));
  return prices.map(([ts, price]) => {
    const t = Math.floor(ts / 1000);
    return { time: t, value: price, marketCap: mcapByTs.get(t) ?? null, volume: volByTs.get(t) ?? null };
  });
}

// ── Contexte macro crypto ────────────────────────────────────────────────────

export interface GlobalCrypto {
  totalMcapUsd: number | null;
  btcDominance: number | null;
  ethDominance: number | null;
  mcapChange24h: number | null;
}

/** Pause entre deux appels CoinGecko — l'offre gratuite plafonne a 10-30 req/min. */
export const coingeckoDelay = (ms = 3000) => new Promise(r => setTimeout(r, ms));

/**
 * Appel CoinGecko avec detection explicite de l'echec.
 *
 * **Le command Rust `fetch_url` ne verifie pas le statut HTTP** : il renvoie le
 * corps quel qu'il soit (`src-tauri/src/lib.rs`). Un 429 arrive donc comme un
 * JSON `{ status: { error_code: 429 } }` parfaitement valide, jamais comme une
 * exception — un simple `try/catch` ne l'attrape pas et laisse croire a une
 * reponse vide. On teste `status.error_code`, sinon un rate limit se traduit
 * par une entree silencieusement neutre dans le score.
 *
 * Retourne `null` en cas d'echec, pour que l'appelant puisse le signaler
 * plutot que de le confondre avec « pas de donnees ».
 */
async function cgFetch(url: string): Promise<Record<string, unknown> | null> {
  try {
    const raw: string = await invoke('fetch_url', { url });
    const data = JSON.parse(raw);
    if (data?.status?.error_code) return null;
    return data;
  } catch {
    return null;
  }
}

/** `cgFetch` avec une seconde tentative apres une pause longue (rate limit). */
async function cgFetchRetry(url: string, retryDelayMs = 8000): Promise<Record<string, unknown> | null> {
  const first = await cgFetch(url);
  if (first) return first;
  await coingeckoDelay(retryDelayMs);
  return cgFetch(url);
}

/**
 * Instantane du marche crypto (`/global`). `null` si l'appel echoue.
 *
 * Attention : seul le **niveau** de dominance est accessible gratuitement.
 * L'historique (`/global/market_cap_chart`) est reserve aux abonnes Pro
 * (`error_code 10005`), donc aucune variation de dominance n'est calculable —
 * d'ou son statut d'indicateur de contexte, hors score. Ne pas essayer de la
 * reconstruire en sommant les capitalisations du top N : l'univers du jour
 * appliqué au passe introduirait un biais de survivance.
 */
export async function fetchGlobalCrypto(): Promise<GlobalCrypto | null> {
  const data = await cgFetchRetry('https://api.coingecko.com/api/v3/global');
  if (!data) return null;
  const d = data.data as Record<string, never> | undefined;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    totalMcapUsd:  num(d?.['total_market_cap']?.['usd']),
    btcDominance:  num(d?.['market_cap_percentage']?.['btc']),
    ethDominance:  num(d?.['market_cap_percentage']?.['eth']),
    mcapChange24h: num(d?.['market_cap_change_percentage_24h_usd']),
  };
}

/**
 * Capitalisation quotidienne d'une piece sur `days` jours. `null` si l'appel
 * echoue — a ne pas confondre avec une serie vide.
 *
 * `interval=daily` est accepte par l'offre gratuite et evite de rapatrier des
 * points horaires inutiles (90j horaires = ~2160 points par piece).
 *
 * Seule la capitalisation est exposee : pour les *prix* crypto, passer par
 * Yahoo (`BTC-USD`, `ETH-USD`), qui n'a pas de quota et aligne exactement ses
 * horodatages journaliers. CoinGecko reste indispensable ici parce que Yahoo
 * ne publie pas l'offre en circulation des stablecoins.
 */
export async function fetchCoinMarketCaps(
  id: string, days = 90,
): Promise<{ time: number; value: number }[] | null> {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const data = await cgFetchRetry(url);
  if (!data) return null;
  const rows = data.market_caps as [number, number][] | undefined;
  if (!rows) return null;
  return rows.map(([ts, v]) => ({ time: Math.floor(ts / 1000), value: v }));
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
