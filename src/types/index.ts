export type AssetType = 'stock' | 'crypto' | 'fiat';

export type TransactionType = 'buy' | 'sell' | 'swap_out' | 'swap_in' | 'split' | 'bonus_share' | 'dividend';

export interface PendingCorporateAction {
  positionId: number;
  ticker: string;
  type: 'split' | 'dividend';
  date: number;
  value: number;        // split: ratio (e.g. 2.0 for 2:1) | dividend: amount/share
  sharesAtDate: number; // qty held at ex-date
}

export interface Transaction {
  id: number;
  position_id: number;
  ticker: string;
  type: TransactionType;
  quantity: number;
  price: number;
  currency: string;
  linked_tx_id: number | null;
  fee: number;
  note: string;
  setup: string | null;
  note_context: string | null;
  created_at: number;
}

export interface TransactionInput {
  position_id: number;
  ticker: string;
  type: TransactionType;
  quantity: number;
  price: number;
  currency: string;
  linked_tx_id?: number | null;
  fee?: number;
  note?: string;
  setup?: string | null;
  note_context?: string | null;
  created_at?: number;
}

export interface Position {
  id: number;
  ticker: string;
  name: string;
  asset_type: AssetType;
  currency: string;
  quantity: number;
  cost_basis: number;
  stop_price: number | null;
  target_price: number | null;
  target_price_2: number | null;
  created_at: number;
}

export interface PositionInput {
  ticker: string;
  name: string;
  asset_type: AssetType;
  currency: string;
  quantity: number;
  cost_basis: number;
  stop_price?: number | null;
  target_price?: number | null;
  target_price_2?: number | null;
}

export interface Snapshot {
  id: number;
  total_value: number;
  total_cost: number;
  recorded_at: number;
}

export interface PriceMap {
  [ticker: string]: number | undefined;
}

export interface PositionWithValue extends Position {
  current_price: number | undefined;
  current_value: number | undefined;
  pnl: number | undefined;
  pnl_pct: number | undefined;
}

export interface HistoricalPoint {
  time: number;
  value: number;
}

export interface Narrative {
  id: number;
  name: string;
  description: string;
  color: string;
  ref_etf: string | null;
  parent_sector: string | null;
  active: number;
  is_preset: number;
  created_at: number;
}

export interface NarrativeInput {
  name: string;
  description: string;
  color: string;
  ref_etf: string | null;
  parent_sector: string | null;
}

export interface NarrativeTicker {
  id: number;
  narrative_id: number;
  ticker: string;
  name: string;
  exchange: string;
  asset_type: string;
}

export interface NarrativeTickerInput {
  ticker: string;
  name: string;
  exchange: string;
}

export interface NarrativeKeyword {
  id: number;
  narrative_id: number;
  keyword: string;
}

export type AlertType = 'rsi_overbought' | 'rsi_oversold' | 'macro_regime_change' | 'price_target' | 'stop_loss' | 'price_below_ma200' | 'ema_cross' | 'sector_score_threshold';
export type AlertScope = 'sector' | 'narrative' | 'macro' | 'ticker';

export interface AlertRule {
  id: number;
  type: AlertType;
  scope: AlertScope;
  scope_id: string;
  label: string;
  threshold: string | null;
  is_active: number;
  created_at: number;
  snoozed_until: number | null;
  is_system: number;
  slot: string | null;
  direction: string | null;
}

export interface AlertRuleInput {
  type: AlertType;
  scope: AlertScope;
  scope_id: string;
  label: string;
  threshold: string | null;
  direction?: string | null;
}

export interface AlertEvent {
  id: number;
  rule_id: number;
  triggered_at: number;
  consecutive_days: number;
  value_at_trigger: string;
  message: string;
  acknowledged: number;
}

export interface SignalLogRow {
  id: number;
  date: string;          // 'YYYY-MM-DD' (local), bucket journalier
  scope: string;         // 'sector' (narratives = futur)
  scope_id: string;      // id secteur, ex 'xlk'
  signal: string;        // 'dip' | 'reversal' | 'accelerating' | 'exhaustion'
  score: number;
  rel_perf_j5: number | null;
  rel_perf_j10: number | null;
  rel_perf_j20: number | null;
}

export interface WatchlistCategory {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  created_at: number;
}

export interface WatchlistItem {
  id: number;
  ticker: string;
  name: string;
  asset_type: 'stock' | 'crypto';
  category_id: number | null;
  added_at: number;
}
