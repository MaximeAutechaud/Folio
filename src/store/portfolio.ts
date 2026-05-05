import { create } from 'zustand';
import type { Position, PositionInput, PriceMap } from '../types';
import { fetchPositions, insertPosition, updatePosition, deletePosition } from '../lib/db';

export type BaseCurrency = 'EUR' | 'USD';

interface PortfolioState {
  positions: Position[];
  prices: PriceMap;
  baseCurrency: BaseCurrency;
  eurUsd: number;
  isLoading: boolean;
  error: string | null;

  loadPositions: () => Promise<void>;
  addPosition: (input: PositionInput) => Promise<void>;
  updatePosition: (id: number, input: PositionInput) => Promise<void>;
  removePosition: (id: number) => Promise<void>;
  setPrices: (prices: PriceMap) => void;
  setBaseCurrency: (c: BaseCurrency) => void;
  setEurUsd: (rate: number) => void;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  positions: [],
  prices: {},
  baseCurrency: 'EUR',
  eurUsd: 1,
  isLoading: false,
  error: null,

  loadPositions: async () => {
    set({ isLoading: true, error: null });
    try {
      const positions = await fetchPositions();
      set({ positions, isLoading: false });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  addPosition: async (input) => {
    const id = await insertPosition(input);
    const newPosition: Position = {
      id,
      ...input,
      ticker: input.ticker.toUpperCase(),
      created_at: Math.floor(Date.now() / 1000),
    };
    set((state) => ({ positions: [...state.positions, newPosition] }));
  },

  updatePosition: async (id, input) => {
    await updatePosition(id, input);
    set((state) => ({
      positions: state.positions.map((p) =>
        p.id === id ? { ...p, ...input, ticker: input.ticker.toUpperCase() } : p
      ),
    }));
  },

  removePosition: async (id) => {
    await deletePosition(id);
    set((state) => ({ positions: state.positions.filter((p) => p.id !== id) }));
  },

  setPrices: (prices) => {
    set((state) => ({ prices: { ...state.prices, ...prices } }));
  },

  setBaseCurrency: (baseCurrency) => set({ baseCurrency }),
  setEurUsd: (eurUsd) => set({ eurUsd }),
}));

// Convert an amount from `from` currency to `to` currency using EURUSD rate
export function convertCurrency(amount: number, from: string, to: string, eurUsd: number): number {
  if (from === to) return amount;
  // Normalise everything through USD as pivot
  const toUsd = from === 'EUR' ? amount * eurUsd : amount;
  if (to === 'USD') return toUsd;
  // to === 'EUR'
  return toUsd / eurUsd;
}

export function computeTotals(
  positions: Position[],
  prices: PriceMap,
  baseCurrency: BaseCurrency,
  eurUsd: number
) {
  let totalValue = 0;
  let totalCost = 0;
  for (const p of positions) {
    const price = prices[p.ticker];
    const cost = convertCurrency(p.quantity * p.cost_basis, p.currency, baseCurrency, eurUsd);
    totalCost += cost;
    if (price != null) {
      totalValue += convertCurrency(p.quantity * price, p.currency, baseCurrency, eurUsd);
    }
  }
  return { totalValue, totalCost };
}
