import { create } from 'zustand';
import type { Position, PositionInput, PriceMap, Transaction, TransactionInput } from '../types';
import {
  fetchPositions,
  insertPosition,
  updatePosition,
  deletePosition,
  fetchAllTransactions,
  fetchTransactions,
  insertTransaction,
  insertSwapTransactions,
  deleteTransaction,
} from '../lib/db';
import { computePRU } from '../lib/pru';

export type BaseCurrency = 'EUR' | 'USD';

interface PortfolioState {
  positions: Position[];
  prices: PriceMap;
  baseCurrency: BaseCurrency;
  eurUsd: number;
  isLoading: boolean;
  error: string | null;
  transactions: Record<number, Transaction[]>;

  loadPositions: () => Promise<void>;
  addPosition: (input: PositionInput) => Promise<void>;
  updatePosition: (id: number, input: PositionInput) => Promise<void>;
  removePosition: (id: number) => Promise<void>;
  setPrices: (prices: PriceMap) => void;
  setBaseCurrency: (c: BaseCurrency) => void;
  setEurUsd: (rate: number) => void;

  addTransaction: (input: TransactionInput) => Promise<void>;
  addSwap: (swapOut: TransactionInput, swapIn: TransactionInput) => Promise<void>;
  removeTransaction: (id: number, positionId: number, linkedPositionId?: number) => Promise<void>;
  refreshTransactions: (positionId: number) => Promise<void>;
}

export const usePortfolioStore = create<PortfolioState>((set) => ({
  positions: [],
  prices: {},
  baseCurrency: 'EUR',
  eurUsd: 1,
  isLoading: false,
  error: null,
  transactions: {},

  loadPositions: async () => {
    set({ isLoading: true, error: null });
    try {
      const [positions, transactions] = await Promise.all([
        fetchPositions(),
        fetchAllTransactions(),
      ]);
      set({ positions, transactions, isLoading: false });
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
    set((state) => {
      const transactions = { ...state.transactions };
      delete transactions[id];
      return {
        positions: state.positions.filter((p) => p.id !== id),
        transactions,
      };
    });
  },

  setPrices: (prices) => {
    set((state) => ({ prices: { ...state.prices, ...prices } }));
  },

  setBaseCurrency: (baseCurrency) => set({ baseCurrency }),
  setEurUsd: (eurUsd) => set({ eurUsd }),

  addTransaction: async (input) => {
    const id = await insertTransaction(input);
    const newTx: Transaction = {
      id,
      linked_tx_id: null,
      fee: input.fee ?? 0,
      note: input.note ?? '',
      created_at: input.created_at ?? Math.floor(Date.now() / 1000),
      position_id: input.position_id,
      ticker: input.ticker,
      type: input.type,
      quantity: input.quantity,
      price: input.price,
      currency: input.currency,
    };
    set((state) => ({
      transactions: {
        ...state.transactions,
        [input.position_id]: [...(state.transactions[input.position_id] ?? []), newTx],
      },
    }));
  },

  addSwap: async (swapOut, swapIn) => {
    const ts = swapOut.created_at ?? Math.floor(Date.now() / 1000);
    const { outId, inId } = await insertSwapTransactions(swapOut, swapIn);
    const outTx: Transaction = {
      id: outId, linked_tx_id: inId, fee: swapOut.fee ?? 0, note: swapOut.note ?? '',
      created_at: ts, position_id: swapOut.position_id, ticker: swapOut.ticker,
      type: 'swap_out', quantity: swapOut.quantity, price: swapOut.price, currency: swapOut.currency,
    };
    const inTx: Transaction = {
      id: inId, linked_tx_id: outId, fee: swapIn.fee ?? 0, note: swapIn.note ?? '',
      created_at: ts, position_id: swapIn.position_id, ticker: swapIn.ticker,
      type: 'swap_in', quantity: swapIn.quantity, price: swapIn.price, currency: swapIn.currency,
    };
    set((state) => ({
      transactions: {
        ...state.transactions,
        [swapOut.position_id]: [...(state.transactions[swapOut.position_id] ?? []), outTx],
        [swapIn.position_id]: [...(state.transactions[swapIn.position_id] ?? []), inTx],
      },
    }));
  },

  removeTransaction: async (id, positionId, linkedPositionId) => {
    await deleteTransaction(id);
    set((state) => {
      const updated = { ...state.transactions };
      const filterOut = (arr: Transaction[]) => arr.filter((t) => t.id !== id && t.linked_tx_id !== id);
      updated[positionId] = filterOut(updated[positionId] ?? []);
      if (linkedPositionId != null) {
        updated[linkedPositionId] = filterOut(updated[linkedPositionId] ?? []);
      }
      return { transactions: updated };
    });
  },

  refreshTransactions: async (positionId) => {
    const txs = await fetchTransactions(positionId);
    set((state) => ({
      transactions: { ...state.transactions, [positionId]: txs },
    }));
  },
}));

// Convert an amount from `from` currency to `to` currency using EURUSD rate
export function convertCurrency(amount: number, from: string, to: string, eurUsd: number): number {
  if (from === to) return amount;
  const toUsd = from === 'EUR' ? amount * eurUsd : amount;
  if (to === 'USD') return toUsd;
  return toUsd / eurUsd;
}

export function resolvePositions(
  positions: Position[],
  transactions: Record<number, Transaction[]>
): Position[] {
  return positions.map((p) => {
    if (p.asset_type === 'fiat') return p;
    const txs = transactions[p.id];
    if (!txs || txs.length === 0) return p;
    // Stored quantity/cost_basis = state before transaction tracking began.
    // Always use as initial state so sells/swaps don't wipe existing holdings,
    // and buys accumulate on top of what was already there.
    const { quantity, costBasis } = computePRU(txs, p.quantity, p.cost_basis);
    return { ...p, quantity, cost_basis: costBasis };
  });
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
    if (p.asset_type === 'fiat') continue;
    const price = prices[p.ticker];
    const cost = convertCurrency(p.quantity * p.cost_basis, p.currency, baseCurrency, eurUsd);
    totalCost += cost;
    if (price != null) {
      totalValue += convertCurrency(p.quantity * price, p.currency, baseCurrency, eurUsd);
    }
  }
  return { totalValue, totalCost };
}
