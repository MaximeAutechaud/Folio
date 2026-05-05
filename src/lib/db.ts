import Database from '@tauri-apps/plugin-sql';
import type { Position, PositionInput, Snapshot } from '../types';

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
