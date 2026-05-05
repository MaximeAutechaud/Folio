export type AssetType = 'stock' | 'crypto';

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
