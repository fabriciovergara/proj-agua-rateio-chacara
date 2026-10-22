import { count, sql } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { Executor } from '#/db/client.server'
import {
  bankAccount,
  monthRates,
  owners,
  properties,
  readings,
  settings,
} from '#/db/schema'

const rowsIn = (db: Executor, table: SQLiteTable) =>
  db.select({ rows: count() }).from(table).get()?.rows ?? 0

/** How much data the app has (Configurações, before wiping it). */
export function dataSummary(db: Executor) {
  return {
    properties: rowsIn(db, properties),
    owners: rowsIn(db, owners),
    readings: rowsIn(db, readings),
    /** Months with a kWh price and reserve fund. */
    months: rowsIn(db, monthRates),
    /** "Cobranças" and "Dados Bancários" were filled in. */
    settings: rowsIn(db, settings) > 0,
    bank: rowsIn(db, bankAccount) > 0,
  }
}

export type DataSummary = ReturnType<typeof dataSummary>

/**
 * Deletes all the data, all or nothing: chácaras, owners, readings, the
 * months' values, "Cobranças" and "Dados Bancários". The passwords stay and
 * unlocked browsers stay unlocked. New records are numbered from 1 again.
 */
export function deleteAllData(db: Executor) {
  db.transaction((tx) => {
    tx.delete(readings).run()
    tx.delete(properties).run()
    tx.delete(owners).run()
    tx.delete(monthRates).run()
    tx.delete(settings).run()
    tx.delete(bankAccount).run()
    tx.run(
      sql`DELETE FROM sqlite_sequence WHERE name IN ('owners', 'properties', 'readings')`,
    )
  })
}
