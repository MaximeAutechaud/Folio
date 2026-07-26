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

/**
 * Début de l'historique long. 2010 écarte la crise de 2008 — un régime si
 * extrême qu'il écraserait toute statistique agrégée — mais couvre 2011, 2015,
 * 2018, 2020 et 2022. Un backtest qui s'arrête à 2 ans ne décrit qu'un seul
 * marché et ne dit rien de la robustesse d'un signal.
 */
export const MAX_DAILY_SINCE = Math.floor(Date.UTC(2010, 0, 1) / 1000);

// `since` et `range` s'excluent : au-delà de 2 ans, Yahoo n'accepte plus de
// `range=` nommé et veut des bornes explicites period1/period2.
const YAHOO_RANGE: Record<string, { range?: string; interval: string; since?: number }> = {
  '1W':        { range: '5d',  interval: '1h' },
  '1M':        { range: '1mo', interval: '1d' },
  '3M':        { range: '3mo', interval: '1d' },
  '6M':        { range: '6mo', interval: '1d' },
  '1Y':        { range: '1y',  interval: '1wk' },
  '1Y_daily':  { range: '1y',  interval: '1d' },
  '2Y':        { range: '2y',  interval: '1wk' },
  '2Y_daily':  { range: '2y',  interval: '1d' },
  'MAX_daily': { since: MAX_DAILY_SINCE, interval: '1d' },
};

/**
 * `includeAdjustedClose=true` (et `events`, que Yahoo exige en pratique pour
 * peupler `indicators.adjclose`) : sans eux la réponse ne contient que le
 * `close`, ajusté des splits mais **pas des dividendes**.
 *
 * Ce n'était pas un détail cosmétique pour le scoring : un ETF distribuant ~1 %
 * par trimestre voit sa perf 3M sous-estimée d'autant, de façon permanente et
 * systématique. Les prédicats de `calcSectorScore` comparent cette perf à des
 * seuils fixes (`relPerf3M < -1.5` pour reversal, `> 3` pour exhaustion), donc
 * XLU, XLP et VNQ franchissaient ces bornes plus tôt que XLK à situation
 * économique égale. Le biais vivait en **entrée** du signal, pas dans la cible.
 */
export function buildHistoryUrl(
  ticker: string, period: string, nowSec = Math.floor(Date.now() / 1000),
): string {
  const spec = YAHOO_RANGE[period] ?? YAHOO_RANGE['1M'];
  const window = spec.since != null
    ? `period1=${spec.since}&period2=${nowSec}`
    : `range=${spec.range}`;
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`
    + `?interval=${spec.interval}&${window}&events=div%7Csplit&includeAdjustedClose=true`;
}

/**
 * Bougie journalière en **rendement total**.
 *
 * `value` est la clôture ajustée : c'est elle que consomment tous les calculs de
 * performance. `open` est l'ouverture ajustée du *même* facteur — sans quoi une
 * ouverture brute comparée à une clôture ajustée fabriquerait un faux gap le
 * jour du détachement, précisément sur la mesure « entrée à l'ouverture J+1 ».
 * `close` garde la clôture brute, seul prix réellement coté.
 *
 * Sur la dernière bougie, `adjclose === close` par construction (l'ajustement
 * est rétroactif) : la valorisation du portefeuille est donc inchangée.
 */
export interface Bar {
  time: number;
  open: number;
  value: number;
  close: number;
}

/**
 * Bougies d'un `chart.result` Yahoo. Exporté pour être testable sans réseau.
 *
 * Repli sur le `close` brut quand `adjclose` est absent : c'est le cas des
 * intervalles intraday (`1W` → `1h`), où Yahoo ne le renvoie jamais. Un repli
 * silencieux est correct ici — sur une fenêtre d'une semaine aucun détachement
 * n'a lieu, donc ajusté et brut coïncident.
 */
export function parseBars(result: unknown): Bar[] {
  const r = result as {
    timestamp?: number[];
    indicators?: {
      quote?: { close?: (number | null)[]; open?: (number | null)[] }[];
      adjclose?: { adjclose?: (number | null)[] }[];
    };
  } | null | undefined;

  const timestamps = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  const opens = r?.indicators?.quote?.[0]?.open ?? [];
  const adj = r?.indicators?.adjclose?.[0]?.adjclose ?? [];

  const out: Bar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null) continue;
    const value = adj[i] ?? close;
    const factor = close !== 0 ? value / close : 1;
    const open = opens[i];
    out.push({
      time: timestamps[i],
      open: open != null ? open * factor : value,
      value,
      close,
    });
  }
  return out;
}

/**
 * Historique ajusté. Le type de retour est `Bar[]` et non `Point[]` : `Bar` en
 * est un sur-ensemble structurel, donc tous les appelants d'affichage
 * fonctionnent sans changement, et les appelants qui ont besoin de l'ouverture
 * (backtest, reconstruction) l'obtiennent sans requête supplémentaire.
 */
export async function fetchYahooHistory(ticker: string, period: string): Promise<Bar[]> {
  const raw: string = await invoke('fetch_url', { url: buildHistoryUrl(ticker, period) });
  const data = JSON.parse(raw);
  return parseBars(data?.chart?.result?.[0]);
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
