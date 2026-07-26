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
  // Zone euro uniquement — les places nordiques et suisses ont leur propre
  // devise et étaient auparavant mappées EUR à tort (valorisation fausse).
  if (/\.(PA|AS|BR|DE|MI|MC|HE|LS|VI)$/.test(t)) return 'EUR';
  if (/\.(SW|VX)$/.test(t)) return 'CHF';
  if (/\.ST$/.test(t)) return 'SEK';
  if (/\.CO$/.test(t)) return 'DKK';
  if (/\.OL$/.test(t)) return 'NOK';
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
  '1W':       { range: '5d',  interval: '1h' },
  '1M':       { range: '1mo', interval: '1d' },
  '3M':       { range: '3mo', interval: '1d' },
  '6M':       { range: '6mo', interval: '1d' },
  '1Y':       { range: '1y',  interval: '1wk' },
  '1Y_daily': { range: '1y',  interval: '1d' },
  '2Y':       { range: '2y',  interval: '1wk' },
  '2Y_daily': { range: '2y',  interval: '1d' },
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

/**
 * Bougie journalière du scanner : ouverture, clôture **ajustée** et volume.
 *
 * Fonction distincte de `fetchYahooHistory`, volontairement, pour trois raisons
 * qui tiennent toutes au fait que le scanner mesure autre chose :
 *
 * 1. Il lui faut le **volume**, que l'historique d'affichage ne parse pas.
 * 2. Il lui faut la clôture **ajustée des dividendes**. Sans le paramètre
 *    `includeAdjustedClose`, `indicators.adjclose` est absent du payload : Yahoo
 *    ne renvoie qu'un `close` ajusté des splits seulement. Un détachement
 *    trimestriel fabrique alors un faux rendement négatif d'un jour — que le
 *    clustering interpréterait comme un mouvement commun aux titres qui
 *    détachent la même semaine.
 * 3. `open` est ajusté du **même facteur** que la clôture, sinon une ouverture
 *    brute comparée à une clôture ajustée fabrique un gap le jour du détachement.
 */
export interface ScannerBar {
  time: number;
  open: number;
  /** Clôture ajustée dividendes + splits. C'est elle que consomment les calculs. */
  value: number;
  /** Clôture brute, seul prix réellement coté. */
  close: number;
  volume: number;
}

/** Bougies d'un `chart.result` Yahoo. Exporté pour être testable sans réseau. */
export function parseScannerBars(result: unknown): ScannerBar[] {
  const r = result as {
    timestamp?: number[];
    indicators?: {
      quote?: { close?: (number | null)[]; open?: (number | null)[]; volume?: (number | null)[] }[];
      adjclose?: { adjclose?: (number | null)[] }[];
    };
  } | null | undefined;

  const timestamps = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0];
  const closes = q?.close ?? [];
  const opens = q?.open ?? [];
  const volumes = q?.volume ?? [];
  const adj = r?.indicators?.adjclose?.[0]?.adjclose ?? [];

  const out: ScannerBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    // Une bougie sans clôture ou sans volume est inexploitable pour un scanner
    // de liquidité : la retenir avec un volume à 0 ferait chuter la médiane et
    // rendrait anormale la séance suivante.
    if (close == null || volumes[i] == null) continue;
    const value = adj[i] ?? close;
    const factor = close !== 0 ? value / close : 1;
    const open = opens[i];
    out.push({
      time: timestamps[i],
      open: open != null ? open * factor : value,
      value,
      close,
      volume: volumes[i]!,
    });
  }
  return out;
}

/**
 * Historique journalier ajusté d'un titre de l'univers.
 *
 * `days` borne la fenêtre demandée : une synchronisation initiale prend un an,
 * une mise à jour quotidienne quelques séances. Sur 900 tickers, la différence
 * n'est pas cosmétique — c'est trois minutes contre quinze secondes.
 */
export async function fetchScannerBars(ticker: string, range = '1y'): Promise<ScannerBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`
    + `?interval=1d&range=${range}&events=div%7Csplit&includeAdjustedClose=true`;
  const raw: string = await invoke('fetch_url', { url });
  const data = JSON.parse(raw);
  return parseScannerBars(data?.chart?.result?.[0]);
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

export interface CorporateEvent {
  type: 'split' | 'dividend';
  date: number;
  value: number; // split: ratio (numerator/denominator) | dividend: amount per share
}

export async function fetchCorporateActions(ticker: string, since: number): Promise<CorporateEvent[]> {
  const now = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${since}&period2=${now}&interval=1d&events=div%7Csplit`;
  try {
    const raw: string = await invoke('fetch_url', { url });
    const data = JSON.parse(raw);
    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const events: CorporateEvent[] = [];

    for (const s of Object.values(result.events?.splits ?? {})) {
      const split = s as { date: number; numerator: number; denominator: number };
      const ratio = split.denominator > 0 ? split.numerator / split.denominator : 0;
      if (ratio > 0 && ratio !== 1) {
        events.push({ type: 'split', date: split.date, value: ratio });
      }
    }

    for (const d of Object.values(result.events?.dividends ?? {})) {
      const div = d as { date: number; amount: number };
      if (div.amount > 0) {
        events.push({ type: 'dividend', date: div.date, value: div.amount });
      }
    }

    return events.sort((a, b) => a.date - b.date);
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
