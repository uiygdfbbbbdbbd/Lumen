import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { DbHandle } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Works from both src/db (tsx) and dist/db (compiled). */
export const MIGRATIONS_DIR = path.resolve(here, '../../drizzle');

interface Journal {
  entries: { idx: number; tag: string; when: number }[];
}

export async function runMigrations(handle: DbHandle): Promise<void> {
  await migrate(handle.db, { migrationsFolder: MIGRATIONS_DIR, migrationsSchema: 'drizzle' });
}

export async function readJournal(): Promise<Journal> {
  return JSON.parse(await readFile(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as Journal;
}

/**
 * Roll back the most recent `steps` migrations using the hand-written files in drizzle/down.
 * Forward migrations are the source of truth; down files exist where reversal is feasible.
 */
export async function rollbackMigrations(handle: DbHandle, steps = 1): Promise<string[]> {
  const journal = await readJournal();
  const applied = await handle.sql<{ id: number; created_at: string }[]>`
    SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT ${steps}`;
  const rolledBack: string[] = [];
  for (const row of applied) {
    const entry = journal.entries.find((e) => String(e.when) === String(row.created_at));
    if (!entry) throw new Error(`Applied migration ${row.created_at} not found in journal`);
    const downSql = await readFile(path.join(MIGRATIONS_DIR, 'down', `${entry.tag}.sql`), 'utf8').catch(() => {
      throw new Error(`Migration ${entry.tag} has no down file and cannot be rolled back`);
    });
    await handle.sql.begin(async (tx) => {
      await tx.unsafe(downSql);
      await tx`DELETE FROM drizzle.__drizzle_migrations WHERE id = ${row.id}`;
    });
    rolledBack.push(entry.tag);
  }
  return rolledBack;
}
