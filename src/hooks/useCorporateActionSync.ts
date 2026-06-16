import { useState, useEffect, useRef, useCallback } from 'react';
import { usePortfolioStore } from '../store/portfolio';
import { fetchCorporateActions } from '../lib/api/yahoo';
import { fetchDismissedCorporateActions, dismissCorporateAction } from '../lib/db';
import { computePRU } from '../lib/pru';
import type { PendingCorporateAction, Transaction } from '../types';

function isAlreadyLogged(txs: Transaction[], type: 'split' | 'dividend', eventDate: number): boolean {
  const dayStart = Math.floor(eventDate / 86400) * 86400;
  const dayEnd = dayStart + 86400;
  // A split event may have been applied as a free-share attribution (bonus_share),
  // so count both when checking whether a split is already in the ledger.
  const matches = type === 'split' ? ['split', 'bonus_share'] : ['dividend'];
  return txs.some((t) => matches.includes(t.type) && t.created_at >= dayStart && t.created_at < dayEnd);
}

export function useCorporateActionSync() {
  const [pendingActions, setPendingActions] = useState<PendingCorporateAction[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const positions = usePortfolioStore((s) => s.positions);
  const storeTransactions = usePortfolioStore((s) => s.transactions);
  const hasAutoRun = useRef(false);

  const runSync = useCallback(async () => {
    if (positions.length === 0) return;

    const now = Math.floor(Date.now() / 1000);

    setIsSyncing(true);
    try {
      const dismissed = await fetchDismissedCorporateActions();
      const stockPositions = positions.filter((p) => p.asset_type === 'stock');
      const pending: PendingCorporateAction[] = [];

      await Promise.allSettled(
        stockPositions.map(async (p) => {
          const txs = storeTransactions[p.id] ?? [];
          const twoYearsAgo = now - 2 * 365 * 86400;
          const since = Math.max(p.created_at - 86400, twoYearsAgo);

          const events = await fetchCorporateActions(p.ticker, since);

          for (const event of events) {
            const key = `${p.ticker}:${event.type}:${event.date}`;
            if (dismissed.has(key)) continue;
            if (isAlreadyLogged(txs, event.type, event.date)) continue;

            const txsBefore = txs.filter((t) => t.created_at <= event.date);
            const { quantity: sharesAtDate } = computePRU(txsBefore, p.quantity, p.cost_basis);

            if (event.type === 'dividend' && sharesAtDate <= 0) continue;

            pending.push({
              positionId: p.id,
              ticker: p.ticker,
              type: event.type,
              date: event.date,
              value: event.value,
              sharesAtDate,
            });
          }
        })
      );

      setPendingActions(pending);
    } finally {
      setIsSyncing(false);
    }
  }, [positions, storeTransactions]);

  // Auto-run once per session on first load (the ref dedups re-mounts;
  // the fetch is cheap enough to run on every app launch)
  useEffect(() => {
    if (hasAutoRun.current || positions.length === 0) return;
    hasAutoRun.current = true;
    runSync().catch(console.error);
  }, [positions.length > 0]);

  function confirmAction(action: PendingCorporateAction) {
    setPendingActions((prev) => prev.filter(
      (a) => !(a.ticker === action.ticker && a.type === action.type && a.date === action.date)
    ));
  }

  async function dismissAction(action: PendingCorporateAction) {
    await dismissCorporateAction(action.ticker, action.type, action.date);
    setPendingActions((prev) => prev.filter(
      (a) => !(a.ticker === action.ticker && a.type === action.type && a.date === action.date)
    ));
  }

  function syncNow() {
    runSync().catch(console.error);
  }

  return { pendingActions, isSyncing, confirmAction, dismissAction, syncNow };
}
