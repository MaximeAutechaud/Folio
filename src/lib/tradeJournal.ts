import type { Transaction } from '../types';

export const SETUP_OPTIONS = [
  { value: 'dip_sectoriel',      label: 'Dip sectoriel' },
  { value: 'reversal_rs',        label: 'Reversal RS' },
  { value: 'breakout',           label: 'Breakout' },
  { value: 'macro_favorable',    label: 'Macro favorable' },
  { value: 'conviction_long_terme', label: 'Conviction LT' },
  { value: 'autre',              label: 'Autre' },
] as const;

export type TradeSetup = (typeof SETUP_OPTIONS)[number]['value'];

export const SETUP_LABEL: Record<string, string> = Object.fromEntries(
  SETUP_OPTIONS.map((o) => [o.value, o.label])
);

export interface NoteContext {
  macroScore?: number | null;
  regime?: string | null;
  initialStop?: number | null;
}

export interface ClosedTrade {
  id: string;
  ticker: string;
  positionName: string;
  setup: string | null;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  currency: string;
  entryDate: number;
  exitDate: number;
  daysHeld: number;
  pnl: number;
  pnlPct: number;
  rMultiple: number | null;
  initialStop: number | null;
  macroScore: number | null;
  regime: string | null;
}

export interface SetupStats {
  setup: string;
  label: string;
  count: number;
  wins: number;
  winRate: number;
  avgPnlPct: number;
}

export interface TradeStats {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  expectancy: number;
  avgR: number | null;
  avgDaysWinners: number;
  avgDaysLosers: number;
  bySetup: SetupStats[];
}

function parseContext(raw: string | null | undefined): NoteContext {
  if (!raw) return {};
  try { return JSON.parse(raw) as NoteContext; } catch { return {}; }
}

interface BuyLot {
  qty: number;
  price: number;
  setup: string | null;
  date: number;
  currency: string;
  initialStop: number | null;
  macroScore: number | null;
  regime: string | null;
}

// Pairs buy/swap_in lots with sell transactions (FIFO).
// initialQty/initialPRU/initialCurrency/initialDate represent the position state
// before transaction tracking began (stored on the position record itself).
// swap_out is skipped — price is an exchange rate, not fiat.
export function buildClosedTrades(
  ticker: string,
  positionName: string,
  transactions: Transaction[],
  initialQty = 0,
  initialPRU = 0,
  initialCurrency = 'USD',
  initialDate = 0,
): ClosedTrade[] {
  const sorted = [...transactions].sort((a, b) => a.created_at - b.created_at);

  const queue: BuyLot[] = [];

  // Synthetic lot for shares that predate transaction tracking
  if (initialQty > 1e-10 && initialPRU > 0) {
    queue.push({
      qty: initialQty,
      price: initialPRU,
      setup: null,
      date: initialDate,
      currency: initialCurrency,
      initialStop: null,
      macroScore: null,
      regime: null,
    });
  }

  const result: ClosedTrade[] = [];
  let closeIdx = 0;

  for (const tx of sorted) {
    if (tx.type === 'buy' || tx.type === 'swap_in') {
      const ctx = parseContext(tx.note_context);
      queue.push({
        qty: tx.quantity,
        price: tx.price,
        setup: tx.setup ?? null,
        date: tx.created_at,
        currency: tx.currency,
        initialStop: ctx.initialStop ?? null,
        macroScore: ctx.macroScore ?? null,
        regime: ctx.regime ?? null,
      });
    } else if (tx.type === 'sell') {
      let remaining = tx.quantity;
      const consumed: { qty: number; lot: BuyLot }[] = [];

      while (remaining > 1e-10 && queue.length > 0) {
        const lot = queue[0];
        const take = Math.min(lot.qty, remaining);
        consumed.push({ qty: take, lot: { ...lot } });
        lot.qty -= take;
        remaining -= take;
        if (lot.qty < 1e-10) queue.shift();
      }

      if (consumed.length === 0) continue;

      const totalQty = consumed.reduce((s, c) => s + c.qty, 0);
      const avgEntry = consumed.reduce((s, c) => s + c.qty * c.lot.price, 0) / totalQty;
      // most recent buy lot = last consumed (consistent with "most recent setup" policy)
      const mostRecent = consumed[consumed.length - 1].lot;
      const { initialStop } = mostRecent;

      const pnl = totalQty * (tx.price - avgEntry);
      const pnlPct = ((tx.price - avgEntry) / avgEntry) * 100;
      const rMultiple =
        initialStop != null && avgEntry > initialStop
          ? (tx.price - avgEntry) / (avgEntry - initialStop)
          : null;

      result.push({
        id: `${tx.id}-${closeIdx++}`,
        ticker,
        positionName,
        setup: mostRecent.setup,
        entryPrice: avgEntry,
        exitPrice: tx.price,
        qty: totalQty,
        currency: mostRecent.currency,
        entryDate: consumed[0].lot.date,
        exitDate: tx.created_at,
        daysHeld: Math.max(0, Math.floor((tx.created_at - consumed[0].lot.date) / 86400)),
        pnl,
        pnlPct,
        rMultiple,
        initialStop,
        macroScore: mostRecent.macroScore,
        regime: mostRecent.regime,
      });
    }
  }

  return result;
}

export function computeStats(trades: ClosedTrade[]): TradeStats | null {
  if (trades.length === 0) return null;

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const winRate = wins.length / trades.length;

  const avgWinPct = wins.length > 0
    ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLossPct = losses.length > 0
    ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const expectancy = winRate * avgWinPct + (1 - winRate) * avgLossPct;

  const rTrades = trades.filter((t) => t.rMultiple != null);
  const avgR = rTrades.length > 0
    ? rTrades.reduce((s, t) => s + t.rMultiple!, 0) / rTrades.length : null;

  const avgDaysWinners = wins.length > 0
    ? wins.reduce((s, t) => s + t.daysHeld, 0) / wins.length : 0;
  const avgDaysLosers = losses.length > 0
    ? losses.reduce((s, t) => s + t.daysHeld, 0) / losses.length : 0;

  const setupMap = new Map<string, ClosedTrade[]>();
  for (const t of trades) {
    const key = t.setup ?? '__none__';
    if (!setupMap.has(key)) setupMap.set(key, []);
    setupMap.get(key)!.push(t);
  }

  const bySetup: SetupStats[] = [...setupMap.entries()]
    .map(([setup, group]) => ({
      setup,
      label: SETUP_LABEL[setup] ?? (setup === '__none__' ? 'Non défini' : setup),
      count: group.length,
      wins: group.filter((t) => t.pnl > 0).length,
      winRate: group.filter((t) => t.pnl > 0).length / group.length,
      avgPnlPct: group.reduce((s, t) => s + t.pnlPct, 0) / group.length,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWinPct,
    avgLossPct,
    expectancy,
    avgR,
    avgDaysWinners,
    avgDaysLosers,
    bySetup,
  };
}
