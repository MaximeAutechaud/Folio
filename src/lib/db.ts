import Database from '@tauri-apps/plugin-sql';
import type { Position, PositionInput, Snapshot, Transaction, TransactionInput } from '../types';

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
