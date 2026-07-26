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
  note: string | null;
  sector_id: string | null;
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
  note?: string | null;
  sector_id?: string | null;
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

export type AlertType = 'rsi_overbought' | 'rsi_oversold' | 'macro_regime_change' | 'price_target' | 'stop_loss' | 'price_below_ma200' | 'ema_cross' | 'sector_score_threshold' | 'signal_change';
// 'all_sectors' : une seule regle couvrant les 11 secteurs (signal_change).
export type AlertScope = 'sector' | 'narrative' | 'macro' | 'ticker' | 'all_sectors';

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
  /** signal_change : liste CSV des signaux qui declenchent. null = tous. */
  signal_filter: string | null;
}

export interface AlertRuleInput {
  type: AlertType;
  scope: AlertScope;
  scope_id: string;
  label: string;
  threshold: string | null;
  direction?: string | null;
  signal_filter?: string | null;
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
  scope: string;         // 'sector' | 'narrative'
  scope_id: string;      // id secteur ('xlk'), ou ticker de l'ETF pour une narrative
  signal: string;        // 'dip' | 'reversal' | 'accelerating' | 'exhaustion'
  score: number;

  // ── Mesure primaire : vs RSP ────────────────────────────────────────────────
  // RSP et pas SPY parce que c'est RSP qui alimente la *détection* (relPerf*_ew
  // dans computeEtfMetrics). Mesurer la cible contre SPY classait en échec un
  // mouvement correctement détecté contre l'équipondéré mais resté derrière les
  // mégacaps : l'asymétrie fabriquait des faux négatifs pendant toute la
  // domination des sept magnifiques.
  rsp_perf_j5: number | null;
  rsp_perf_j10: number | null;
  rsp_perf_j20: number | null;
  rsp_perf_j40: number | null;

  // Excursions extrêmes du parcours relatif (vs RSP) : elles disent si une
  // espérance nulle recouvre du bruit symétrique ou une asymétrie récoltable.
  mfe_j20: number | null;
  mae_j20: number | null;
  mfe_j40: number | null;
  mae_j40: number | null;

  // ── Mesures secondaires ─────────────────────────────────────────────────────
  /** vs SPY — conservé pour la continuité de lecture avec l'ancien log. */
  rel_perf_j5: number | null;
  rel_perf_j10: number | null;
  rel_perf_j20: number | null;
  /** vs panier équipondéré des autres secteurs (scope `sector` uniquement). */
  peer_perf_j20: number | null;

  // ── Contexte au moment du signal (migration v15) ────────────────────────────
  // Support des découpes de diagnostic. Ce sont les deux critères que
  // `calcSectorScore` traite en commentaire (décote de sous-score) plutôt qu'en
  // condition d'entrée — les persister est le seul moyen de savoir s'ils
  // devraient devenir des conditions.
  /** 0/1 SQLite ; `null` = série trop courte pour une MA50. */
  ma50_above: number | null;
  macro_score: number | null;
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
