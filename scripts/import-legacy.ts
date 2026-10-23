/**
 * Imports the data of the original Microsoft Access app (Kw.mdb), exported
 * as CSV (T_Usuarios.csv, T_Fatura.csv, T_Consumo.csv — e.g. with
 * `mdb-export Kw.mdb T_Usuarios > T_Usuarios.csv` from mdbtools).
 *
 *   bun run db:import-legacy <folder-with-csvs>           # adds what's missing
 *   bun run db:import-legacy <folder-with-csvs> --reset   # wipes data first
 *
 * Each old "usuário" becomes a proprietário and a chácara, unless that
 * chácara is already in the app; each row of T_Cosumo becomes a reading in
 * the period of its dates, keeping what it was charged. Periods where a
 * chácara already has a reading keep it as it is (see
 * src/server/legacy.server.ts).
 */
import { openDatabase } from '#/db/client.server'
import {
  describeLegacyImport,
  importLegacy,
  type LegacyExport,
  readLegacyExport,
} from '#/server/legacy.server'

const folder = process.argv[2]
const reset = process.argv.includes('--reset')

if (!folder || folder.startsWith('--')) {
  console.error(
    'Informe a pasta com os CSVs: bun run db:import-legacy ./legacy [--reset]',
  )
  process.exit(1)
}

let data: LegacyExport
try {
  data = readLegacyExport(folder)
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}

// Not getDb(): with LEGACY_DATA_PATH set, it would fill the database first.
const db = openDatabase(process.env.DATABASE_PATH || 'data/rateio.sqlite')
console.log(describeLegacyImport(importLegacy(db, data, { reset })))
