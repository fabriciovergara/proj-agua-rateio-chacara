/**
 * Creates the database (data/rateio.sqlite, or DATABASE_PATH) and applies
 * pending migrations. The app also does this on start; this script is for
 * preparing a server ahead of time.
 */
import path from 'node:path'
import { getDb } from '#/db/client.server'

getDb()
console.log(
  `Banco de dados pronto: ${path.resolve(process.env.DATABASE_PATH || 'data/rateio.sqlite')}`,
)
