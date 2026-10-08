import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema/index.ts';

export type Db = ReturnType<typeof createDb>;

/** Folder with drizzle-kit generated SQL migrations. */
export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../drizzle');

/**
 * Opens (or creates) the SQLite database with the pragmas we rely on.
 * Pass `':memory:'` for tests.
 */
export function createDb(url: string) {
  if (url !== ':memory:') mkdirSync(dirname(resolve(url)), { recursive: true });
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  return drizzle(sqlite, { schema });
}

export function runMigrations(db: Db, migrationsFolder = MIGRATIONS_DIR): void {
  migrate(db, { migrationsFolder });
}

/** Fresh in-memory database with all migrations applied (tests). */
export function createTestDb(): Db {
  const db = createDb(':memory:');
  runMigrations(db);
  return db;
}
