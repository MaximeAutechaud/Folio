export function calcEma(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

export function calcMa(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((s, p) => s + p, 0) / period;
}

// RSI 14 rolling series — returns one value per input point (starting at index `period`)
export function calcRsiSeries(
  points: { time: number; value: number }[],
  period = 14
): { time: number; value: number }[] {
  if (points.length <= period) return [];

  const prices = points.map(p => p.value);
  const changes = prices.slice(1).map((p, i) => p - prices[i]);

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  const result: { time: number; value: number }[] = [];
  const push = (idx: number, g: number, l: number) => {
    const rsi = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    result.push({ time: points[idx].time, value: parseFloat(rsi.toFixed(2)) });
  };

  push(period, avgGain, avgLoss);

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-changes[i], 0)) / period;
    push(i + 1, avgGain, avgLoss);
  }

  return result;
}

// RSI 14 — Wilder's smoothing method (standard)
export function calcRsi(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;

  const changes = prices.slice(1).map((p, i) => p - prices[i]);

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-changes[i], 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return Math.round(100 - 100 / (1 + avgGain / avgLoss));
}
