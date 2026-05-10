import Database from '@tauri-apps/plugin-sql';
import type { Position, PositionInput, Snapshot, Transaction, TransactionInput, Narrative, NarrativeInput, NarrativeTicker, NarrativeTickerInput, NarrativeKeyword } from '../types';
import { NARRATIVE_SEED } from './narratives-seed';

const DB_URL = 'sqlite:folio.db';

let _db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load(DB_URL);
    await runMigrations(_db);
  }
  return _db;
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

  // Add currency column to existing DBs that predate this migration
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
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_snapshots_recorded_at ON snapshots(recorded_at)`
  );

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
    CREATE TABLE IF NOT EXISTS narratives (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      color       TEXT    NOT NULL DEFAULT '#6366f1',
      ref_etf     TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS narrative_tickers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      narrative_id INTEGER NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
      ticker       TEXT    NOT NULL,
      name         TEXT    NOT NULL DEFAULT '',
      exchange     TEXT    NOT NULL DEFAULT '',
      asset_type   TEXT    NOT NULL DEFAULT 'stock'
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ntickers_narrative ON narrative_tickers(narrative_id)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS narrative_keywords (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      narrative_id INTEGER NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
      keyword      TEXT    NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS price_history (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker  TEXT    NOT NULL,
      date    TEXT    NOT NULL,
      close   REAL    NOT NULL,
      volume  REAL    NOT NULL DEFAULT 0,
      UNIQUE(ticker, date)
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ph_ticker_date ON price_history(ticker, date)`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sentiment_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      narrative_id INTEGER NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
      date         TEXT    NOT NULL,
      volume_7d    INTEGER NOT NULL DEFAULT 0,
      volume_prev  INTEGER NOT NULL DEFAULT 0,
      score        REAL    NOT NULL DEFAULT 0,
      mainstream   INTEGER NOT NULL DEFAULT 0,
      UNIQUE(narrative_id, date)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS fundamentals_history (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      narrative_id        INTEGER NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
      date                TEXT    NOT NULL,
      score               REAL    NOT NULL DEFAULT 0,
      recommendation_mean REAL,
      buy_count           INTEGER NOT NULL DEFAULT 0,
      hold_count          INTEGER NOT NULL DEFAULT 0,
      sell_count          INTEGER NOT NULL DEFAULT 0,
      UNIQUE(narrative_id, date)
    )
  `);

  await seedNarrativesIfEmpty(db);
}

async function seedNarrativesIfEmpty(db: Database): Promise<void> {
  const count = await db.select<{ n: number }[]>('SELECT COUNT(*) as n FROM narratives');
  if (count[0].n > 0) return;

  for (const n of NARRATIVE_SEED) {
    const result = await db.execute(
      'INSERT INTO narratives (name, description, color, ref_etf) VALUES ($1, $2, $3, $4)',
      [n.name, n.description, n.color, n.ref_etf]
    );
    const narrativeId = result.lastInsertId as number;

    for (const t of n.tickers) {
      await db.execute(
        'INSERT INTO narrative_tickers (narrative_id, ticker, name, exchange) VALUES ($1, $2, $3, $4)',
        [narrativeId, t.ticker, t.name, t.exchange]
      );
    }

    for (const keyword of n.keywords) {
      await db.execute(
        'INSERT INTO narrative_keywords (narrative_id, keyword) VALUES ($1, $2)',
        [narrativeId, keyword]
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
    `INSERT INTO positions (ticker, name, asset_type, currency, quantity, cost_basis)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.ticker.toUpperCase(), input.name, input.asset_type, input.currency, input.quantity, input.cost_basis]
  );
  return result.lastInsertId as number;
}

export async function updatePosition(id: number, input: PositionInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE positions SET ticker=$1, name=$2, asset_type=$3, currency=$4, quantity=$5, cost_basis=$6 WHERE id=$7`,
    [input.ticker.toUpperCase(), input.name, input.asset_type, input.currency, input.quantity, input.cost_basis, id]
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

export async function fetchNarratives(): Promise<Narrative[]> {
  const db = await getDb();
  return db.select<Narrative[]>('SELECT * FROM narratives ORDER BY id ASC');
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
    'INSERT INTO narratives (name, description, color, ref_etf) VALUES ($1, $2, $3, $4)',
    [input.name, input.description, input.color, input.ref_etf]
  );
  return result.lastInsertId as number;
}

export async function updateNarrative(id: number, input: NarrativeInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    'UPDATE narratives SET name=$1, description=$2, color=$3, ref_etf=$4 WHERE id=$5',
    [input.name, input.description, input.color, input.ref_etf, id]
  );
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

// ── Price history ─────────────────────────────────────────────────────────

export async function upsertPriceHistory(
  ticker: string,
  rows: { date: string; close: number; volume: number }[]
): Promise<void> {
  const db = await getDb();
  for (const row of rows) {
    await db.execute(
      `INSERT INTO price_history (ticker, date, close, volume) VALUES ($1, $2, $3, $4)
       ON CONFLICT(ticker, date) DO UPDATE SET close=excluded.close, volume=excluded.volume`,
      [ticker, row.date, row.close, row.volume]
    );
  }
}

export async function fetchStoredPriceHistory(
  ticker: string,
  limit = 250
): Promise<{ date: string; close: number }[]> {
  const db = await getDb();
  return db.select<{ date: string; close: number }[]>(
    `SELECT date, close FROM price_history WHERE ticker=$1 ORDER BY date ASC LIMIT $2`,
    [ticker, limit]
  );
}

export async function getLastPriceDate(ticker: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ date: string }[]>(
    `SELECT date FROM price_history WHERE ticker=$1 ORDER BY date DESC LIMIT 1`,
    [ticker]
  );
  return rows[0]?.date ?? null;
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

// ── Sentiment history ─────────────────────────────────────────────────────

export interface SentimentRecord {
  narrative_id: number;
  date: string;
  volume_7d: number;
  volume_prev: number;
  score: number;
  mainstream: number;
}

export async function upsertSentiment(
  narrativeId: number,
  date: string,
  data: { volume7d: number; volumePrev: number; score: number; mainstream: boolean }
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO sentiment_history (narrative_id, date, volume_7d, volume_prev, score, mainstream)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(narrative_id, date) DO UPDATE SET
       volume_7d=excluded.volume_7d, volume_prev=excluded.volume_prev,
       score=excluded.score, mainstream=excluded.mainstream`,
    [narrativeId, date, data.volume7d, data.volumePrev, data.score, data.mainstream ? 1 : 0]
  );
}

export async function fetchLatestSentiment(narrativeId: number): Promise<SentimentRecord | null> {
  const db = await getDb();
  const rows = await db.select<SentimentRecord[]>(
    `SELECT * FROM sentiment_history WHERE narrative_id=$1 ORDER BY date DESC LIMIT 1`,
    [narrativeId]
  );
  return rows[0] ?? null;
}

export async function getLastSentimentDate(narrativeId: number): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ date: string }[]>(
    `SELECT date FROM sentiment_history WHERE narrative_id=$1 ORDER BY date DESC LIMIT 1`,
    [narrativeId]
  );
  return rows[0]?.date ?? null;
}

export interface FundamentalsRecord {
  id: number;
  narrative_id: number;
  date: string;
  score: number;
  recommendation_mean: number | null;
  buy_count: number;
  hold_count: number;
  sell_count: number;
}

export async function upsertFundamentals(
  narrativeId: number,
  date: string,
  data: { score: number; recommendationMean: number | null; buyCount: number; holdCount: number; sellCount: number }
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO fundamentals_history (narrative_id, date, score, recommendation_mean, buy_count, hold_count, sell_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(narrative_id, date) DO UPDATE SET
       score=excluded.score, recommendation_mean=excluded.recommendation_mean,
       buy_count=excluded.buy_count, hold_count=excluded.hold_count, sell_count=excluded.sell_count`,
    [narrativeId, date, data.score, data.recommendationMean, data.buyCount, data.holdCount, data.sellCount]
  );
}

export async function fetchLatestFundamentals(narrativeId: number): Promise<FundamentalsRecord | null> {
  const db = await getDb();
  const rows = await db.select<FundamentalsRecord[]>(
    `SELECT * FROM fundamentals_history WHERE narrative_id=$1 ORDER BY date DESC LIMIT 1`,
    [narrativeId]
  );
  return rows[0] ?? null;
}

export async function getLastFundamentalsDate(narrativeId: number): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ date: string }[]>(
    `SELECT date FROM fundamentals_history WHERE narrative_id=$1 ORDER BY date DESC LIMIT 1`,
    [narrativeId]
  );
  return rows[0]?.date ?? null;
}
