import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { prefillFromLegacy } from '#/server/legacy.server'
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

/**
 * The app's database. With LEGACY_DATA_PATH set, an empty one is first
 * filled with the old Access app's data (see src/server/legacy.server.ts).
 */
export function getDb(): DB {
  if (!globalForDb.__rateioDb) {
    const db = openDatabase(process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH)
    const legacyFolder = process.env.LEGACY_DATA_PATH?.trim()
    if (legacyFolder) {
      try {
        prefillFromLegacy(db, legacyFolder)
      } catch (error) {
        db.$client.close()
        throw error
      }
    }
    globalForDb.__rateioDb = db
  }
  return globalForDb.__rateioDb
}
