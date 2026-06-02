import { useState, useEffect } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  fetchWatchlist, addWatchlistItem, removeWatchlistItem, assignWatchlistCategory,
  fetchWatchlistCategories, insertWatchlistCategory, renameWatchlistCategory, deleteWatchlistCategory,
} from '../lib/db';
import { fetchYahooHistory } from '../lib/api/yahoo';
import { fetchCryptoPrices } from '../lib/api/coingecko';
import { calcRsi } from '../lib/indicators';
import type { WatchlistItem, WatchlistCategory } from '../types';

export interface WatchlistRow extends WatchlistItem {
  price: number | null;
  change1d: number | null;
  rsi: number | null;
  vsMA50: number | null;
  drawdown: number | null;
  loading: boolean;
}

export interface WatchlistGroup {
  category: WatchlistCategory | null;
  rows: WatchlistRow[];
}

type TickerData = {
  price: number | null;
  change1d: number | null;
  closes: number[];
};

async function fetchStockData(ticker: string): Promise<TickerData> {
  const hist = await fetchYahooHistory(ticker, '3M');
  const closes = hist.map(p => p.value);
  const price = closes[closes.length - 1] ?? null;
  const prev  = closes[closes.length - 2] ?? null;
  const change1d = price != null && prev != null ? ((price - prev) / prev) * 100 : null;
  return { price, change1d, closes };
}

async function fetchCryptoData(id: string): Promise<TickerData> {
  const prices = await fetchCryptoPrices([id]);
  const price = prices[id.toUpperCase()] ?? null;
  return { price, change1d: null, closes: [] };
}

function calcMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcDrawdown(prices: number[]): number | null {
  if (prices.length === 0) return null;
  const high = Math.max(...prices);
  const last = prices[prices.length - 1];
  return high === 0 ? null : ((last - high) / high) * 100;
}

export function useWatchlist() {
  const [items, setItems]           = useState<WatchlistItem[]>([]);
  const [categories, setCategories] = useState<WatchlistCategory[]>([]);

  async function reload() {
    const [w, c] = await Promise.all([fetchWatchlist(), fetchWatchlistCategories()]);
    setItems(w);
    setCategories(c);
  }

  useEffect(() => { reload(); }, []);

  const queries = useQueries({
    queries: items.map(item => ({
      queryKey: ['watchlist-data', item.ticker, item.asset_type],
      queryFn: () =>
        item.asset_type === 'crypto'
          ? fetchCryptoData(item.ticker)
          : fetchStockData(item.ticker),
      staleTime: 5 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
    })),
  });

  const rows: WatchlistRow[] = items.map((item, i) => {
    const q      = queries[i];
    const data   = q?.data;
    const closes = data?.closes ?? [];
    const ma50   = calcMA(closes, 50);
    const price  = data?.price ?? null;
    return {
      ...item,
      price,
      change1d: data?.change1d ?? null,
      rsi:      calcRsi(closes),
      vsMA50:   ma50 != null && price != null ? ((price - ma50) / ma50) * 100 : null,
      drawdown: calcDrawdown(closes),
      loading:  q?.isLoading ?? true,
    };
  });

  // Group rows by category + uncategorized at the end
  const groups: WatchlistGroup[] = [
    ...categories.map(cat => ({
      category: cat,
      rows: rows.filter(r => r.category_id === cat.id),
    })),
    {
      category: null,
      rows: rows.filter(r => r.category_id == null),
    },
  ];

  // ── Mutations ────────────────────────────────────────────────────────────────

  async function addItem(ticker: string, name: string, assetType: 'stock' | 'crypto', categoryId?: number | null) {
    await addWatchlistItem({ ticker, name, asset_type: assetType, category_id: categoryId ?? null });
    await reload();
  }

  async function removeItem(id: number) {
    await removeWatchlistItem(id);
    setItems(prev => prev.filter(x => x.id !== id));
  }

  async function assignToCategory(itemId: number, categoryId: number | null) {
    await assignWatchlistCategory(itemId, categoryId);
    setItems(prev => prev.map(x => x.id === itemId ? { ...x, category_id: categoryId } : x));
  }

  async function addCategory(name: string, color: string) {
    await insertWatchlistCategory(name, color);
    setCategories(await fetchWatchlistCategories());
  }

  async function renameCategory(id: number, name: string) {
    await renameWatchlistCategory(id, name);
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name } : c));
  }

  async function removeCategory(id: number) {
    await deleteWatchlistCategory(id);
    setItems(prev => prev.map(x => x.category_id === id ? { ...x, category_id: null } : x));
    setCategories(prev => prev.filter(c => c.id !== id));
  }

  return { rows, groups, categories, addItem, removeItem, assignToCategory, addCategory, renameCategory, removeCategory };
}
