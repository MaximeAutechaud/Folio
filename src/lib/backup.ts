import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { downloadDir, join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { backupDatabaseTo, closeDatabase, DB_FILE_NAME } from './db';

// Horodatage à la seconde : `VACUUM INTO` refuse d'écraser un fichier existant,
// le nom doit donc être unique. Deux sauvegardes dans la même seconde échouent
// explicitement plutôt que d'écraser silencieusement la précédente.
export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `folio-backup-${date}_${time}.db`;
}

/**
 * Écrit une copie complète de la base dans le dossier Téléchargements et ouvre
 * l'explorateur dessus. Destination volontairement distincte du dossier de
 * l'application : une sauvegarde posée à côté de l'original ne protège de rien.
 * Retourne le chemin écrit.
 */
export async function exportDatabase(): Promise<string> {
  const dir = await downloadDir();
  const destPath = await join(dir, backupFileName());
  await backupDatabaseTo(destPath);
  // Le révélateur de fichier est un confort, pas la sauvegarde : son échec ne
  // doit pas faire passer un backup réussi pour une erreur.
  try {
    await revealItemInDir(destPath);
  } catch {
    /* ignore */
  }
  return destPath;
}

// ── Import ───────────────────────────────────────────────────────────────────

/** Tables sans lesquelles le fichier n'est pas une base Folio exploitable. */
const REQUIRED_TABLES = ['positions', 'transactions', 'snapshots', 'settings'];

export interface BackupPreview {
  path: string;
  fileName: string;
  schemaVersion: string | null;
  positions: number;
  transactions: number;
  snapshots: number;
}

/** Ouvre le sélecteur natif. `null` si l'utilisateur annule. */
export async function pickBackupFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    defaultPath: await downloadDir().catch(() => undefined),
    filters: [{ name: 'Sauvegarde Folio', extensions: ['db'] }],
  });
  return typeof selected === 'string' ? selected : null;
}

/**
 * Ouvre la sauvegarde en lecture pour vérifier que c'est bien une base Folio et
 * en résumer le contenu, AVANT tout remplacement. Possible parce que le
 * `path_mapper` de tauri-plugin-sql fait un `PathBuf::push` : un chemin absolu
 * écrase le dossier applicatif au lieu de s'y ajouter.
 *
 * N'exécute aucune migration — le fichier n'est pas modifié.
 */
export async function inspectBackup(path: string): Promise<BackupPreview> {
  let probe: Database;
  try {
    probe = await Database.load(`sqlite:${path}`);
  } catch (e) {
    throw new Error(`Fichier illisible : ${String(e)}`);
  }

  try {
    const tables = await probe.select<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`
    );
    const present = new Set(tables.map((t) => t.name));
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
    if (missing.length > 0) {
      throw new Error(
        `Ce fichier n'est pas une sauvegarde Folio (tables manquantes : ${missing.join(', ')}).`
      );
    }

    const count = async (table: string) => {
      const rows = await probe.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`);
      return rows[0]?.n ?? 0;
    };
    const version = await probe.select<{ value: string }[]>(
      `SELECT value FROM settings WHERE key = 'schema_version'`
    );

    return {
      path,
      fileName: path.split(/[\\/]/).pop() ?? path,
      schemaVersion: version[0]?.value ?? null,
      positions: await count('positions'),
      transactions: await count('transactions'),
      snapshots: await count('snapshots'),
    };
  } finally {
    // Sans fermeture, le pool garde le fichier ouvert et le remplacement échoue.
    await probe.close().catch(() => {});
  }
}

/**
 * Remplace la base courante par la sauvegarde. Ferme la connexion, délègue
 * l'échange de fichier au Rust (atomique, contrairement à une recopie SQL —
 * cf. le commentaire de `restore_database`), et retourne le chemin de la copie
 * de sécurité prise juste avant.
 *
 * L'appelant DOIT recharger la page ensuite : le store et le cache TanStack
 * décrivent encore l'ancienne base.
 */
export async function restoreFromBackup(path: string): Promise<string> {
  await closeDatabase();
  return invoke<string>('restore_database', { srcPath: path, dbFile: DB_FILE_NAME });
}
