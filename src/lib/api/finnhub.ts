import { invoke } from '@tauri-apps/api/core';

interface FinnhubPeriod {
  buy: number;
  hold: number;
  sell: number;
  strongBuy: number;
  strongSell: number;
  period: string;
  symbol: string;
}

export interface FundamentalsData {
  recommendationMean: number | null;
  buyCount: number;
  holdCount: number;
  sellCount: number;
}

export async function fetchFinnhubRecommendation(ticker: string, apiKey: string): Promise<FundamentalsData> {
  const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  try {
    const raw: string = await invoke('fetch_url', { url });
    const data = JSON.parse(raw) as FinnhubPeriod[];
    if (!Array.isArray(data) || data.length === 0) {
      return { recommendationMean: null, buyCount: 0, holdCount: 0, sellCount: 0 };
    }

    // Most recent period first
    const latest = data.sort((a, b) => b.period.localeCompare(a.period))[0];
    const { strongBuy, buy, hold, sell, strongSell } = latest;
    const total = strongBuy + buy + hold + sell + strongSell;

    const recommendationMean = total > 0
      ? parseFloat(((1 * strongBuy + 2 * buy + 3 * hold + 4 * sell + 5 * strongSell) / total).toFixed(2))
      : null;

    return {
      recommendationMean,
      buyCount:  strongBuy + buy,
      holdCount: hold,
      sellCount: sell + strongSell,
    };
  } catch {
    return { recommendationMean: null, buyCount: 0, holdCount: 0, sellCount: 0 };
  }
}
