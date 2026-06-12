import Database from '@tauri-apps/plugin-sql';
import type { Position, PositionInput, Snapshot, Transaction, TransactionInput, Narrative, NarrativeInput, NarrativeTicker, NarrativeTickerInput, NarrativeKeyword, AlertRule, AlertRuleInput, AlertEvent, WatchlistItem, WatchlistCategory } from '../types';
import { NARRATIVE_SEED } from './narratives-seed';

const SCHEMA_VERSION = '5';

const DB_URL = 'sqlite:folio.db';

let _dbPromise: Promise<Database> | null = null;

async function getDb(): Promise<Database> {
  if (!_dbPromise) {
    _dbPromise = (async () => {
      const db = await Database.load(DB_URL);
      await runMigrations(db);
      return db;
    })();
  }
  return _dbPromise;
}

async function runMigrations(db: Database): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS positions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker     TEXT    NOT NULL,
      name       TEXT    NOT NULL DEFAULT '',
      asset_type TEXT    NOT NULL DEFAULT 'stock',
      currency   TEXT    NOT NULL DEFAULT 'USD',
      quantity   REAL    NOT NULL,
      cost_basis REAL    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  const cols = await db.select<{ name: string }[]>(
    `SELECT name FROM pragma_table_info('positions') WHERE name='currency'`
  );
  if (cols.length === 0) {
    await db.execute(`ALTER TABLE positions ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'`);
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      total_value REAL    NOT NULL,
      total_cost  REAL    NOT NULL,
      recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_snapshots_recorded_at ON snapshots(recorded_at)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id  INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
      ticker       TEXT    NOT NULL,
      type         TEXT    NOT NULL,
      quantity     REAL    NOT NULL,
      price        REAL    NOT NULL,
      currency     TEXT    NOT NULL DEFAULT 'USD',
      linked_tx_id INTEGER,
      fee          REAL    NOT NULL DEFAULT 0,
      note         TEXT    NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_tx_position ON transactions(position_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await migrateToV2(db);
  await migrateToV3(db);
  await migrateToV4(db);
  await migrateToV5(db);
  await migrateToV6(db);

  // alert_rules: is_system + slot (Phase 1 extension)
  const isSystemCol = await db.select<{ name: string }[]>(
    `SELECT name FROM pragma_table_info('alert_rules') WHERE name='is_system'`
  );
  if (isSystemCol.length === 0) {
    await db.execute(`ALTER TABLE alert_rules ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0`);
  }
  const slotCol = await db.select<{ name: string }[]>(
    `SELECT name FROM pragma_table_info('alert_rules') WHERE name='slot'`
  );
  if (slotCol.length === 0) {
    await db.execute(`ALTER TABLE alert_rules ADD COLUMN slot TEXT`);
  }

  // positions: second take-profit target (Phase 1 extension)
  const tp2Col = await db.select<{ name: string }[]>(
    `SELECT name FROM pragma_table_info('positions') WHERE name='target_price_2'`
  );
  if (tp2Col.length === 0) {
    await db.execute(`ALTER TABLE positions ADD COLUMN target_price_2 REAL`);
  }

  await purgeOldSnapshots(db);
}

// Keep full resolution for the last 7 days; keep 1 snapshot/hour beyond that.
async function purgeOldSnapshots(db: Database): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  await db.execute(`
    DELETE FROM snapshots
    WHERE recorded_at < $1
      AND id NOT IN (
        SELECT MIN(id) FROM snapshots
        WHERE recorded_at < $1
        GROUP BY (recorded_at / 3600)
      )
  `, [cutoff]);
}

async function migrateToV2(db: Database): Promise<void> {
  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM settings WHERE key='schema_version'`
  );
  if (parseInt(rows[0]?.value ?? '0') >= 2) return;

  // Drop legacy narrative tables (order matters for FK constraints)
  await db.execute('DROP TABLE IF EXISTS fundamentals_history');
  await db.execute('DROP TABLE IF EXISTS sentiment_history');
  await db.execute('DROP TABLE IF EXISTS price_history');
  await db.execute('DROP TABLE IF EXISTS narrative_keywords');
  await db.execute('DROP TABLE IF EXISTS narrative_tickers');
  await db.execute('DROP TABLE IF EXISTS narratives');

  await db.execute(`
    CREATE TABLE narratives (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      description   TEXT    NOT NULL DEFAULT '',
      color         TEXT    NOT NULL DEFAULT '#6366f1',
      ref_etf       TEXT,
      parent_sector TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      is_preset     INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.execute(`
    CREATE TABLE narrative_tickers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      narrative_id INTEGER NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
      ticker       TEXT    NOT NULL,
      name         TEXT    NOT NULL DEFAULT '',
      exchange     TEXT    NOT NULL DEFAULT '',
      asset_type   TEXT    NOT NULL DEFAULT 'stock'
    )
  `);
  await db.execute(`CREATE INDEX idx_ntickers_narrative ON narrative_tickers(narrative_id)`);

  await db.execute(`
    CREATE TABLE narrative_keywords (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      narrative_id INTEGER NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
      keyword      TEXT    NOT NULL
    )
  `);

  await seedNarratives(db);

  await db.execute(
    `INSERT INTO settings (key, value) VALUES ('schema_version', '2')
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  );
}

async function migrateToV3(db: Database): Promise<void> {
  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM settings WHERE key='schema_version'`
  );
  if (parseInt(rows[0]?.value ?? '0') >= 3) return;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT    NOT NULL,
      scope         TEXT    NOT NULL,
      scope_id      TEXT    NOT NULL DEFAULT '',
      label         TEXT    NOT NULL,
      threshold     TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      snoozed_until INTEGER
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS alert_events (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id          INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
      triggered_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      consecutive_days INTEGER NOT NULL DEFAULT 1,
      value_at_trigger TEXT    NOT NULL DEFAULT '',
      message          TEXT    NOT NULL,
      acknowledged     INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_alert_events_rule ON alert_events(rule_id)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_alert_events_ack  ON alert_events(acknowledged)`);

  await db.execute(
    `INSERT INTO settings (key, value) VALUES ('schema_version', '3')
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  );
}

async function tableExists(db: Database, name: string): Promise<boolean> {
  const rows = await db.select<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=$1`,
    [name]
  );
  return rows.length > 0;
}

async function migrateToV4(db: Database): Promise<void> {
  // Guard on actual table existence (not schema_version): a past bug stamped
  // fresh DBs as v5 before the watchlist tables existed — this self-repairs them
  if (await tableExists(db, 'watchlist')) return;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker     TEXT    NOT NULL UNIQUE,
      name       TEXT    NOT NULL DEFAULT '',
      asset_type TEXT    NOT NULL DEFAULT 'stock',
      added_at   INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.execute(
    `INSERT INTO settings (key, value) VALUES ('schema_version', '4')
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  );
}

async function migrateToV5(db: Database): Promise<void> {
  if (await tableExists(db, 'watchlist_categories')) return;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS watchlist_categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      color      TEXT    NOT NULL DEFAULT '#6e7681',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  const col = await db.select<{ name: string }[]>(
    `SELECT name FROM pragma_table_info('watchlist') WHERE name='category_id'`
  );
  if (col.length === 0) {
    await db.execute(
      `ALTER TABLE watchlist ADD COLUMN category_id INTEGER REFERENCES watchlist_categories(id) ON DELETE SET NULL`
    );
  }

  await db.execute(
    `INSERT INTO settings (key, value) VALUES ('schema_version', $1)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [SCHEMA_VERSION]
  );
}

async function migrateToV6(db: Database): Promise<void> {
  const col = await db.select<{ name: string }[]>(
    `SELECT name FROM pragma_table_info('positions') WHERE name='stop_price'`
  );
  if (col.length > 0) return;

  await db.execute(`ALTER TABLE positions ADD COLUMN stop_price REAL`);
  await db.execute(`ALTER TABLE positions ADD COLUMN target_price REAL`);

  await db.execute(
    `INSERT INTO settings (key, value) VALUES ('schema_version', '6')
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  );
}

async function seedNarratives(db: Database): Promise<void> {
  for (const n of NARRATIVE_SEED) {
    const result = await db.execute(
      `INSERT INTO narratives (name, description, color, ref_etf, parent_sector, active, is_preset)
       VALUES ($1, $2, $3, $4, $5, 1, 1)`,
      [n.name, n.description, n.color, n.ref_etf, n.parent_sector]
    );
    const narrativeId = result.lastInsertId as number;
    for (const t of n.tickers) {
      await db.execute(
        'INSERT INTO narrative_tickers (narrative_id, ticker, name, exchange) VALUES ($1, $2, $3, $4)',
        [narrativeId, t.ticker, t.name, t.exchange]
      );
    }
  }
}


export async function fetchPositions(): Promise<Position[]> {
  const db = await getDb();
  return db.select<Position[]>('SELECT * FROM positions ORDER BY created_at ASC');
}

export async function insertPosition(input: PositionInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO positions (ticker, name, asset_type, currency, quantity, cost_basis, stop_price, target_price, target_price_2)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [input.ticker.toUpperCase(), input.name, input.asset_type, input.currency, input.quantity, input.cost_basis, input.stop_price ?? null, input.target_price ?? null, input.target_price_2 ?? null]
  );
  return result.lastInsertId as number;
}

export async function updatePosition(id: number, input: PositionInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE positions SET ticker=$1, name=$2, asset_type=$3, currency=$4, quantity=$5, cost_basis=$6, stop_price=$7, target_price=$8, target_price_2=$9 WHERE id=$10`,
    [input.ticker.toUpperCase(), input.name, input.asset_type, input.currency, input.quantity, input.cost_basis, input.stop_price ?? null, input.target_price ?? null, input.target_price_2 ?? null, id]
  );
}

export async function deletePosition(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM positions WHERE id = $1', [id]);
}

export async function fetchSnapshots(limitDays = 90): Promise<Snapshot[]> {
  const db = await getDb();
  const since = Math.floor(Date.now() / 1000) - limitDays * 86400;
  return db.select<Snapshot[]>(
    'SELECT * FROM snapshots WHERE recorded_at >= $1 ORDER BY recorded_at ASC',
    [since]
  );
}

export async function insertSnapshot(totalValue: number, totalCost: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT INTO snapshots (total_value, total_cost) VALUES ($1, $2)',
    [totalValue, totalCost]
  );
}

export async function fetchAllTransactions(): Promise<Record<number, Transaction[]>> {
  const db = await getDb();
  const all = await db.select<Transaction[]>('SELECT * FROM transactions ORDER BY created_at ASC');
  const map: Record<number, Transaction[]> = {};
  for (const tx of all) {
    if (!map[tx.position_id]) map[tx.position_id] = [];
    map[tx.position_id].push(tx);
  }
  return map;
}

export async function fetchTransactions(positionId: number): Promise<Transaction[]> {
  const db = await getDb();
  return db.select<Transaction[]>(
    'SELECT * FROM transactions WHERE position_id = $1 ORDER BY created_at ASC',
    [positionId]
  );
}

export async function insertTransaction(input: TransactionInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO transactions (position_id, ticker, type, quantity, price, currency, linked_tx_id, fee, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.position_id,
      input.ticker,
      input.type,
      input.quantity,
      input.price,
      input.currency,
      input.linked_tx_id ?? null,
      input.fee ?? 0,
      input.note ?? '',
      input.created_at ?? Math.floor(Date.now() / 1000),
    ]
  );
  return result.lastInsertId as number;
}

export async function insertSwapTransactions(
  swapOut: TransactionInput,
  swapIn: TransactionInput
): Promise<{ outId: number; inId: number }> {
  const db = await getDb();
  const ts = swapOut.created_at ?? Math.floor(Date.now() / 1000);

  const outResult = await db.execute(
    `INSERT INTO transactions (position_id, ticker, type, quantity, price, currency, fee, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [swapOut.position_id, swapOut.ticker, 'swap_out', swapOut.quantity, swapOut.price, swapOut.currency, swapOut.fee ?? 0, swapOut.note ?? '', ts]
  );
  const outId = outResult.lastInsertId as number;

  const inResult = await db.execute(
    `INSERT INTO transactions (position_id, ticker, type, quantity, price, currency, linked_tx_id, fee, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [swapIn.position_id, swapIn.ticker, 'swap_in', swapIn.quantity, swapIn.price, swapIn.currency, outId, swapIn.fee ?? 0, swapIn.note ?? '', ts]
  );
  const inId = inResult.lastInsertId as number;

  await db.execute('UPDATE transactions SET linked_tx_id = $1 WHERE id = $2', [inId, outId]);

  return { outId, inId };
}

export async function deleteTransaction(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM transactions WHERE id = $1 OR linked_tx_id = $1', [id]);
}

export async function fetchNarratives(activeOnly = false): Promise<Narrative[]> {
  const db = await getDb();
  const where = activeOnly ? 'WHERE active = 1' : '';
  return db.select<Narrative[]>(`SELECT * FROM narratives ${where} ORDER BY is_preset DESC, id ASC`);
}

export async function fetchAllNarrativeTickers(): Promise<NarrativeTicker[]> {
  const db = await getDb();
  return db.select<NarrativeTicker[]>('SELECT * FROM narrative_tickers ORDER BY narrative_id, id ASC');
}

export async function fetchNarrativeTickers(narrativeId: number): Promise<NarrativeTicker[]> {
  const db = await getDb();
  return db.select<NarrativeTicker[]>(
    'SELECT * FROM narrative_tickers WHERE narrative_id = $1 ORDER BY id ASC',
    [narrativeId]
  );
}

export async function fetchNarrativeKeywords(narrativeId: number): Promise<NarrativeKeyword[]> {
  const db = await getDb();
  return db.select<NarrativeKeyword[]>(
    'SELECT * FROM narrative_keywords WHERE narrative_id = $1 ORDER BY id ASC',
    [narrativeId]
  );
}

export async function insertNarrative(input: NarrativeInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO narratives (name, description, color, ref_etf, parent_sector, active, is_preset)
     VALUES ($1, $2, $3, $4, $5, 1, 0)`,
    [input.name, input.description, input.color, input.ref_etf, input.parent_sector]
  );
  return result.lastInsertId as number;
}

export async function updateNarrative(id: number, input: NarrativeInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    'UPDATE narratives SET name=$1, description=$2, color=$3, ref_etf=$4, parent_sector=$5 WHERE id=$6',
    [input.name, input.description, input.color, input.ref_etf, input.parent_sector, id]
  );
}

export async function toggleNarrativeActive(id: number, active: boolean): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE narratives SET active=$1 WHERE id=$2', [active ? 1 : 0, id]);
}

export async function deleteNarrative(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM narratives WHERE id = $1', [id]);
}

export async function replaceNarrativeTickers(narrativeId: number, tickers: NarrativeTickerInput[]): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM narrative_tickers WHERE narrative_id = $1', [narrativeId]);
  for (const t of tickers) {
    await db.execute(
      'INSERT INTO narrative_tickers (narrative_id, ticker, name, exchange) VALUES ($1, $2, $3, $4)',
      [narrativeId, t.ticker, t.name, t.exchange]
    );
  }
}

export async function replaceNarrativeKeywords(narrativeId: number, keywords: string[]): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM narrative_keywords WHERE narrative_id = $1', [narrativeId]);
  for (const keyword of keywords) {
    await db.execute(
      'INSERT INTO narrative_keywords (narrative_id, keyword) VALUES ($1, $2)',
      [narrativeId, keyword]
    );
  }
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key=$1',
    [key]
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [key, value]
  );
}

// ── Alert rules ───────────────────────────────────────────────────────────────

export async function fetchAlertRules(): Promise<AlertRule[]> {
  const db = await getDb();
  return db.select<AlertRule[]>('SELECT * FROM alert_rules ORDER BY created_at DESC');
}

export async function insertAlertRule(input: AlertRuleInput): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO alert_rules (type, scope, scope_id, label, threshold)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.type, input.scope, input.scope_id, input.label, input.threshold]
  );
  return result.lastInsertId as number;
}

export async function deleteAlertRule(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM alert_rules WHERE id = $1', [id]);
}

export async function upsertStopAlertRule(ticker: string, stopPrice: number): Promise<void> {
  const db = await getDb();
  const existing = await db.select<{ id: number }[]>(
    `SELECT id FROM alert_rules WHERE type='stop_loss' AND scope='ticker' AND scope_id=$1`,
    [ticker]
  );
  if (existing.length > 0) {
    await db.execute(
      `UPDATE alert_rules SET threshold=$1, is_active=1, is_system=1, slot='stop' WHERE id=$2`,
      [String(stopPrice), existing[0].id]
    );
  } else {
    await db.execute(
      `INSERT INTO alert_rules (type, scope, scope_id, label, threshold, is_system, slot)
       VALUES ('stop_loss', 'ticker', $1, $2, $3, 1, 'stop')`,
      [ticker, `Stop — ${ticker}`, String(stopPrice)]
    );
  }
}

export async function removeStopAlertRule(ticker: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM alert_rules WHERE type='stop_loss' AND scope='ticker' AND scope_id=$1`,
    [ticker]
  );
}

export async function upsertTargetAlertRules(
  ticker: string,
  tp1: number | null,
  tp2: number | null
): Promise<void> {
  const db = await getDb();

  for (const [slot, price] of [['tp1', tp1], ['tp2', tp2]] as [string, number | null][]) {
    if (price == null) {
      await db.execute(
        `DELETE FROM alert_rules WHERE type='price_target' AND scope='ticker' AND scope_id=$1 AND slot=$2`,
        [ticker, slot]
      );
      continue;
    }
    const existing = await db.select<{ id: number }[]>(
      `SELECT id FROM alert_rules WHERE type='price_target' AND scope='ticker' AND scope_id=$1 AND slot=$2`,
      [ticker, slot]
    );
    const label = `${slot === 'tp1' ? 'TP1' : 'TP2'} — ${ticker}`;
    if (existing.length > 0) {
      await db.execute(
        `UPDATE alert_rules SET threshold=$1, is_active=1, is_system=1, label=$2 WHERE id=$3`,
        [String(price), label, existing[0].id]
      );
    } else {
      await db.execute(
        `INSERT INTO alert_rules (type, scope, scope_id, label, threshold, is_system, slot)
         VALUES ('price_target', 'ticker', $1, $2, $3, 1, $4)`,
        [ticker, label, String(price), slot]
      );
    }
  }
}

export async function removeTargetAlertRules(ticker: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM alert_rules WHERE type='price_target' AND scope='ticker' AND scope_id=$1 AND is_system=1`,
    [ticker]
  );
}

export async function toggleAlertRule(id: number, active: boolean): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE alert_rules SET is_active=$1 WHERE id=$2', [active ? 1 : 0, id]);
}

export async function snoozeAlertRule(id: number, hours: number): Promise<void> {
  const db = await getDb();
  const until = Math.floor(Date.now() / 1000) + hours * 3600;
  await db.execute('UPDATE alert_rules SET snoozed_until=$1 WHERE id=$2', [until, id]);
}

// ── Alert events ──────────────────────────────────────────────────────────────

export async function fetchAlertEvents(limit = 50): Promise<AlertEvent[]> {
  const db = await getDb();
  return db.select<AlertEvent[]>(
    `SELECT e.*, r.label as rule_label
     FROM alert_events e
     JOIN alert_rules r ON r.id = e.rule_id
     WHERE e.consecutive_days > 0
     ORDER BY e.triggered_at DESC LIMIT $1`,
    [limit]
  );
}

export async function fetchUnacknowledgedCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM alert_events
     WHERE acknowledged = 0 AND consecutive_days > 0`
  );
  return rows[0]?.count ?? 0;
}

export async function insertAlertEvent(
  ruleId: number,
  consecutiveDays: number,
  valueAtTrigger: string,
  message: string
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO alert_events (rule_id, consecutive_days, value_at_trigger, message)
     VALUES ($1, $2, $3, $4)`,
    [ruleId, consecutiveDays, valueAtTrigger, message]
  );
  return result.lastInsertId as number;
}

export async function insertBaselineAlertEvent(ruleId: number, valueAtTrigger: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO alert_events (rule_id, triggered_at, consecutive_days, value_at_trigger, message, acknowledged)
     VALUES ($1, $2, 0, $3, 'baseline', 1)`,
    [ruleId, Math.floor(Date.now() / 1000), valueAtTrigger]
  );
}

export async function getLastAlertEvent(ruleId: number): Promise<AlertEvent | null> {
  const db = await getDb();
  const rows = await db.select<AlertEvent[]>(
    `SELECT * FROM alert_events WHERE rule_id=$1 ORDER BY triggered_at DESC LIMIT 1`,
    [ruleId]
  );
  return rows[0] ?? null;
}

export async function acknowledgeAlertEvent(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE alert_events SET acknowledged=1 WHERE id=$1', [id]);
}

export async function acknowledgeAllAlertEvents(): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE alert_events SET acknowledged=1 WHERE acknowledged=0');
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const db = await getDb();
  return db.select<WatchlistItem[]>('SELECT * FROM watchlist ORDER BY added_at DESC');
}

export async function addWatchlistItem(item: { ticker: string; name: string; asset_type: string; category_id?: number | null }): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR IGNORE INTO watchlist (ticker, name, asset_type, category_id) VALUES ($1, $2, $3, $4)',
    [item.ticker, item.name, item.asset_type, item.category_id ?? null]
  );
}

export async function removeWatchlistItem(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM watchlist WHERE id = $1', [id]);
}

export async function assignWatchlistCategory(itemId: number, categoryId: number | null): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE watchlist SET category_id=$1 WHERE id=$2', [categoryId, itemId]);
}

// ── Watchlist categories ──────────────────────────────────────────────────────

export async function fetchWatchlistCategories(): Promise<WatchlistCategory[]> {
  const db = await getDb();
  return db.select<WatchlistCategory[]>('SELECT * FROM watchlist_categories ORDER BY sort_order ASC, created_at ASC');
}

export async function insertWatchlistCategory(name: string, color: string): Promise<number> {
  const db = await getDb();
  const max = await db.select<{ m: number }[]>('SELECT COALESCE(MAX(sort_order),0) as m FROM watchlist_categories');
  const order = (max[0]?.m ?? 0) + 1;
  const result = await db.execute(
    'INSERT INTO watchlist_categories (name, color, sort_order) VALUES ($1, $2, $3)',
    [name, color, order]
  );
  return result.lastInsertId as number;
}

export async function renameWatchlistCategory(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE watchlist_categories SET name=$1 WHERE id=$2', [name, id]);
}

export async function deleteWatchlistCategory(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM watchlist_categories WHERE id=$1', [id]);
}
