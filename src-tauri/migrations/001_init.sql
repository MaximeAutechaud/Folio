CREATE TABLE IF NOT EXISTS positions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker    TEXT    NOT NULL,
  name      TEXT    NOT NULL DEFAULT '',
  asset_type TEXT   NOT NULL CHECK(asset_type IN ('stock', 'crypto')) DEFAULT 'stock',
  quantity  REAL    NOT NULL CHECK(quantity > 0),
  cost_basis REAL   NOT NULL CHECK(cost_basis >= 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  total_value REAL    NOT NULL,
  total_cost  REAL    NOT NULL,
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_snapshots_recorded_at ON snapshots(recorded_at);
