export type AssetType = 'stock' | 'crypto' | 'fiat';

export type TransactionType = 'buy' | 'sell' | 'swap_out' | 'swap_in';

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
  created_at: number;
}

export interface PositionInput {
  ticker: string;
  name: string;
  asset_type: AssetType;
  currency: string;
  quantity: number;
  cost_basis: number;
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
