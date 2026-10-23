import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import * as schema from './schema'

const DEFAULT_DATABASE_PATH = 'data/rateio.sqlite'
// Resolved from the working directory: the server code gets bundled into
// dist/, so paths relative to this file would not survive a production build.
export const MIGRATIONS_FOLDER = path.resolve(
  process.env.MIGRATIONS_PATH || 'drizzle',
)

/**
 * Opens (or creates) the SQLite database and applies pending migrations, so a
 * fresh install only needs `bun run dev` / `bun run start`.
 * Pass `':memory:'` for throwaway databases in tests.
 */
export function openDatabase(file = DEFAULT_DATABASE_PATH) {
  const location = file === ':memory:' ? file : path.resolve(file)
  if (location !== ':memory:') {
    mkdirSync(path.dirname(location), { recursive: true })
  }

  const sqlite = new Database(location, { create: true, strict: true })
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  sqlite.exec('PRAGMA busy_timeout = 5000;')

  const db = drizzle({ client: sqlite, schema })
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  return db
}

export type DB = ReturnType<typeof openDatabase>
/** The database itself or an open transaction. */
export type Executor = BaseSQLiteDatabase<'sync', void, typeof schema>

// Reuse one connection across Vite hot reloads in development.
const globalForDb = globalThis as { __rateioDb?: DB }

export function getDb(): DB {
  globalForDb.__rateioDb ??= openDatabase(
    process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH,
  )
  return globalForDb.__rateioDb
}
