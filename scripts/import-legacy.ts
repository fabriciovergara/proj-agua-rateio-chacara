/**
 * Imports the data of the original Microsoft Access app: its database
 * (Kw.mdb, Agua.mdb), a .zip with it, or a folder with its tables exported
 * as CSV (T_Usuarios.csv, T_Fatura.csv, T_Consumo.csv — e.g. with
 * `mdb-export Kw.mdb T_Usuarios > T_Usuarios.csv` from mdbtools).
 *
 *   bun run db:import-legacy <Agua.mdb | Agua.zip | folder>           # adds what's missing
 *   bun run db:import-legacy <Agua.mdb | Agua.zip | folder> --reset   # wipes data first
 *
 * Each old "usuário" becomes a proprietário and a chácara, unless that
 * chácara is already in the app; each row of T_Cosumo becomes a reading in
 * the period of its dates, keeping what it was charged. Periods where a
 * chácara already has a reading keep it as it is (see
 * src/server/legacy.server.ts).
 */
import { getDb } from '#/db/client.server'
import {
  describeLegacyImport,
  importLegacy,
  type LegacyExport,
  readLegacyPath,
} from '#/server/legacy.server'

const source = process.argv[2]
const reset = process.argv.includes('--reset')

if (!source || source.startsWith('--')) {
  console.error(
    'Informe o arquivo do Access, o .zip ou a pasta com os CSVs: bun run db:import-legacy ./Agua.mdb [--reset]',
  )
  process.exit(1)
}

let data: LegacyExport
try {
  data = readLegacyPath(source)
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}

if (data.olderCopies?.length) {
  console.log(
    `Do .zip entrou ${data.database}, o arquivo do Access com as leituras mais recentes; ficou de fora: ${data.olderCopies.join(', ')}.`,
  )
}
console.log(describeLegacyImport(importLegacy(getDb(), data, { reset })))
