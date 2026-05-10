export interface TickerIndicators {
  rsi14: number | null;
  ma50: number | null;
  ma200: number | null;
  currentPrice: number | null;
  priceChange30d: number | null;
  signal: 'bullish' | 'bearish' | 'neutral';
}

export interface NarrativeMetrics {
  avgRSI: number | null;
  pctAboveMA200: number | null;
  momentum30d: number | null;
  source: 'etf' | 'aggregate';
  sourceLabel: string;
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (closes.length <= period) return new Array(closes.length).fill(null);

  for (let i = 0; i < period; i++) result.push(null);

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  return result;
}

function calcSMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    return closes.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0) / period;
  });
}

export function computeIndicators(data: { close: number }[]): TickerIndicators {
  if (data.length < 15) {
    return { rsi14: null, ma50: null, ma200: null, currentPrice: null, priceChange30d: null, signal: 'neutral' };
  }

  const closes = data.map(d => d.close);
  const rsiArr = calcRSI(closes);
  const ma50Arr = calcSMA(closes, 50);
  const ma200Arr = calcSMA(closes, 200);

  const last = closes.length - 1;
  const rsi14 = rsiArr[last] ?? null;
  const ma50 = ma50Arr[last] ?? null;
  const ma200 = ma200Arr[last] ?? null;
  const currentPrice = closes[last];
  const idx30 = Math.max(0, last - 30);
  const priceChange30d = closes[idx30] > 0
    ? ((currentPrice - closes[idx30]) / closes[idx30]) * 100
    : null;

  const signal: TickerIndicators['signal'] =
    ma50 != null && ma200 != null
      ? currentPrice > ma50 && currentPrice > ma200 ? 'bullish'
      : currentPrice < ma50 && currentPrice < ma200 ? 'bearish'
      : 'neutral'
      : 'neutral';

  return { rsi14, ma50, ma200, currentPrice, priceChange30d, signal };
}

export function computeNarrativeMetrics(
  tickers: string[],
  indicators: Record<string, TickerIndicators>,
  refEtf?: string | null
): NarrativeMetrics {
  // Prefer ref_etf as single representative signal
  if (refEtf) {
    const etf = indicators[refEtf];
    if (etf?.currentPrice != null) {
      return {
        avgRSI: etf.rsi14,
        pctAboveMA200: etf.ma200 != null ? (etf.currentPrice > etf.ma200 ? 100 : 0) : null,
        momentum30d: etf.priceChange30d,
        source: 'etf',
        sourceLabel: refEtf,
      };
    }
  }

  // Fallback: aggregate individual tickers
  const valid = tickers.filter(t => indicators[t]?.currentPrice != null);
  if (valid.length === 0) {
    return { avgRSI: null, pctAboveMA200: null, momentum30d: null, source: 'aggregate', sourceLabel: `${tickers.length} ticker${tickers.length !== 1 ? 's' : ''}` };
  }

  const withRSI = valid.filter(t => indicators[t].rsi14 != null);
  const avgRSI = withRSI.length > 0
    ? withRSI.reduce((s, t) => s + indicators[t].rsi14!, 0) / withRSI.length
    : null;

  const withMA200 = valid.filter(t => indicators[t].ma200 != null);
  const pctAboveMA200 = withMA200.length > 0
    ? (withMA200.filter(t => indicators[t].currentPrice! > indicators[t].ma200!).length / withMA200.length) * 100
    : null;

  const withMom = valid.filter(t => indicators[t].priceChange30d != null);
  const momentum30d = withMom.length > 0
    ? withMom.reduce((s, t) => s + indicators[t].priceChange30d!, 0) / withMom.length
    : null;

  return { avgRSI, pctAboveMA200, momentum30d, source: 'aggregate', sourceLabel: `Moy. ${valid.length} ticker${valid.length !== 1 ? 's' : ''}` };
}
