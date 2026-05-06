import { usePortfolioStore } from '../store/portfolio';
import type { Transaction } from '../types';

const EMPTY: Transaction[] = [];

export function useTransactions(positionId: number): {
  transactions: Transaction[];
  isCalculated: boolean;
} {
  const transactions = usePortfolioStore((s) => s.transactions[positionId] ?? EMPTY);
  return { transactions, isCalculated: transactions.length > 0 };
}
