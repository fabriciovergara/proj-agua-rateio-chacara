import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { asc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { type DB, type Executor, MIGRATIONS_FOLDER } from '#/db/client.server'
import * as schema from '#/db/schema'
import {
  type BankAccount,
  bankAccount,
  type MonthRates,
  monthRates,
  type Owner,
  owners,
  type Property,
  properties,
  type Reading,
  readings,
  type Settings,
  settings,
} from '#/db/schema'
import { UserFacingError } from '#/lib/errors'
import { todayISO } from '#/lib/periods'
import {
  chacaraMonth,
  chacarasInApp,
  comparable,
  type LegacyImportResult,
  monthsInApp,
  type Place,
} from './legacy.server'

/**
 * A consistent copy of the whole database (VACUUM INTO works while the app
 * is running). Restoring is replacing data/rateio.sqlite with this file, or
 * importing it into an empty app (see importBackup). The app password stays
 * (a restore must not remove it); the sessions of unlocked devices are left
 * out.
 */
export async function createBackup(db: DB): Promise<ArrayBuffer> {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rateio-backup-'))
  const file = path.join(directory, 'rateio.sqlite')
  try {
    db.$client.run('VACUUM INTO ?', [file])
    const copy = new Database(file)
    try {
      copy.run('DELETE FROM sessions')
      copy.run('VACUUM')
    } finally {
      copy.close()
    }
    return await Bun.file(file).arrayBuffer()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** The backup as a file download (Configurações and /api/exportar). */
export async function backupResponse(db: DB): Promise<Response> {
  return new Response(await createBackup(db), {
    headers: {
      'Content-Type': 'application/vnd.sqlite3',
      'Content-Disposition': `attachment; filename="rateio-da-agua-${todayISO()}.sqlite"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** Every SQLite database starts with these 16 bytes. */
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\0')

export function isSqliteFile(bytes: Uint8Array): boolean {
  return SQLITE_HEADER.every((byte, index) => bytes[index] === byte)
}

/** The data of a backup, read back by readBackup. */
export type BackupContents = {
  settings: Settings | null
  bank: BankAccount | null
  monthRates: MonthRates[]
  owners: Owner[]
  properties: Property[]
  readings: Reading[]
}

/** Tables every version of the app has (the first migration made them). */
const FIRST_TABLES = [
  '__drizzle_migrations',
  'owners',
  'properties',
  'readings',
]

const notABackup = () =>
  new UserFacingError(
    'Este arquivo não é uma cópia de segurança do Rateio da Água.',
  )

/**
 * Reads a file made by "Baixar cópia dos dados" (or /api/exportar), in a
 * temporary folder. A copy made by an older version of the app gets the
 * newer migrations first; one made by a newer version is refused, since
 * this one wouldn't know all of its data.
 */
export function readBackup(bytes: Uint8Array): BackupContents {
  if (!isSqliteFile(bytes)) throw notABackup()
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rateio-import-'))
  let sqlite: Database | undefined
  try {
    const file = path.join(directory, 'rateio.sqlite')
    writeFileSync(file, bytes)
    sqlite = new Database(file, { strict: true })

    const tables = new Set(
      sqlite
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table'",
        )
        .all()
        .map(({ name }) => name),
    )
    if (!FIRST_TABLES.every((table) => tables.has(table))) throw notABackup()

    const newestInCopy = sqlite
      .query<{ at: number | null }, []>(
        'SELECT max(created_at) AS at FROM __drizzle_migrations',
      )
      .get()?.at
    const newestHere = Math.max(
      ...readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).map(
        (migration) => migration.folderMillis,
      ),
    )
    if (Number(newestInCopy) > newestHere) {
      throw new UserFacingError(
        'Esta cópia foi feita por uma versão mais nova do app. Atualize o app e tente de novo.',
      )
    }

    const copy = drizzle({ client: sqlite, schema })
    migrate(copy, { migrationsFolder: MIGRATIONS_FOLDER })
    return {
      settings: copy.select().from(settings).get() ?? null,
      bank: copy.select().from(bankAccount).get() ?? null,
      monthRates: copy.select().from(monthRates).all(),
      owners: copy.select().from(owners).orderBy(asc(owners.id)).all(),
      properties: copy
        .select()
        .from(properties)
        .orderBy(asc(properties.id))
        .all(),
      readings: copy.select().from(readings).orderBy(asc(readings.id)).all(),
    }
  } catch (error) {
    if (error instanceof UserFacingError) throw error
    throw new UserFacingError(
      'Não foi possível ler a cópia de segurança. O arquivo pode estar danificado.',
    )
  } finally {
    sqlite?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

export type BackupImportResult = LegacyImportResult & {
  /** Proprietários added, with a new chácara or on their own. */
  owners: number
  /** Months whose kWh price and reserve fund came from the copy. */
  months: number
  /** "Cobranças" and "Dados Bancários" came from the copy. */
  settings: boolean
  bank: boolean
}

/**
 * Brings a backup's data in like the old app's: only what the app doesn't
 * have yet, and nothing already there changes. A chácara with the same name
 * or meter is the same chácara: it keeps its owner and gets only the months
 * it lacks. A new chácara's owner is the proprietário with the same name,
 * if the app has one. "Cobranças", "Dados Bancários" and each month's values
 * come only when the app has none. Records keep their numbers (as in
 * /chacaras/3) when the app isn't using them, so after "Apagar todos os
 * dados" this restores the copy exactly. Passwords never come from a copy.
 */
export function importBackup(
  db: Executor,
  backup: BackupContents,
): BackupImportResult {
  const result: BackupImportResult = {
    created: 0,
    matched: 0,
    readings: 0,
    existing: 0,
    skipped: [],
    owners: 0,
    months: 0,
    settings: false,
    bank: false,
  }

  try {
    db.transaction((tx) => {
      if (backup.settings && !tx.select().from(settings).get()) {
        tx.insert(settings).values(backup.settings).run()
        result.settings = true
      }
      if (backup.bank && !tx.select().from(bankAccount).get()) {
        tx.insert(bankAccount).values(backup.bank).run()
        result.bank = true
      }
      for (const rates of backup.monthRates) {
        const added = tx
          .insert(monthRates)
          .values(rates)
          .onConflictDoNothing()
          .returning({ year: monthRates.year })
          .get()
        if (added) result.months++
      }

      // Numbers in use. A record keeps the copy's number when it is free;
      // otherwise it gets a new one, which is then in use too.
      const idsOf = (rows: { id: number }[]) =>
        new Set(rows.map(({ id }) => id))
      const ownerIds = idsOf(tx.select({ id: owners.id }).from(owners).all())
      const propertyIds = idsOf(
        tx.select({ id: properties.id }).from(properties).all(),
      )
      const readingIds = idsOf(
        tx.select({ id: readings.id }).from(readings).all(),
      )
      const free = (used: Set<number>, id: number) =>
        used.has(id) ? undefined : id

      // Proprietários already in the app, by name.
      const ownerByName = new Map<string, number>()
      for (const { id, name } of tx
        .select({ id: owners.id, name: owners.name })
        .from(owners)
        .orderBy(asc(owners.id))
        .all()) {
        const key = comparable(name)
        if (key && !ownerByName.has(key)) ownerByName.set(key, id)
      }
      // Copy's owner id → app's owner id
      const ownerFor = new Map<number, number>()
      const addOwner = ({ id, ...owner }: Owner) => {
        let appId = ownerFor.get(id) ?? ownerByName.get(comparable(owner.name))
        if (appId === undefined) {
          appId = tx
            .insert(owners)
            .values({ ...owner, id: free(ownerIds, id) })
            .returning({ id: owners.id })
            .get().id
          ownerIds.add(appId)
          result.owners++
        }
        ownerFor.set(id, appId)
        return appId
      }

      // Copy's chácara id → chácara in the app
      const findInApp = chacarasInApp(tx)
      const chacaraFor = new Map<number, Place>()
      const claimed = new Set<number>()
      const copyOwners = new Map(
        backup.owners.map((owner) => [owner.id, owner]),
      )
      for (const { id, ownerId, ...property } of backup.properties) {
        const candidates = findInApp({
          name: property.name,
          meter: property.meterNumber,
        })
        const [found] = candidates
        if (candidates.length > 1 || (found && claimed.has(found.id))) {
          result.skipped.push(
            candidates.length > 1
              ? `${property.name}: o app tem mais de uma chácara com esse nome ou hidrômetro; as leituras dela não foram importadas`
              : `${property.name}: a cópia tem outra chácara com esse nome ou hidrômetro; as leituras dela não foram importadas`,
          )
          continue
        }
        if (found) {
          claimed.add(found.id)
          chacaraFor.set(id, found)
          result.matched++
          continue
        }
        const owner = ownerId === null ? undefined : copyOwners.get(ownerId)
        const added = tx
          .insert(properties)
          .values({
            ...property,
            id: free(propertyIds, id),
            ownerId: owner ? addOwner(owner) : null,
          })
          .returning({ id: properties.id, name: properties.name })
          .get()
        propertyIds.add(added.id)
        chacaraFor.set(id, added)
        result.created++
      }

      // Proprietários without a chácara in the copy come too.
      const withChacara = new Set(backup.properties.map((p) => p.ownerId))
      for (const owner of backup.owners) {
        if (!withChacara.has(owner.id)) addOwner(owner)
      }

      // Months each chácara already has: those stay as they are.
      const taken = monthsInApp(tx)
      for (const { id, propertyId, ...reading } of backup.readings) {
        const chacara = chacaraFor.get(propertyId)
        if (!chacara) continue // Left out above, with the reason.
        const key = chacaraMonth(chacara.id, reading)
        if (taken.has(key)) {
          result.existing++
          continue
        }
        taken.add(key)
        const added = tx
          .insert(readings)
          .values({
            ...reading,
            id: free(readingIds, id),
            propertyId: chacara.id,
          })
          .returning({ id: readings.id })
          .get()
        readingIds.add(added.id)
        result.readings++
      }
    })
  } catch (error) {
    // The copy's own rules are the app's, so this means a damaged file.
    console.error('Cópia de segurança não importada:', error)
    throw new UserFacingError(
      'A cópia tem dados que o app não aceita. Nada foi importado.',
    )
  }
  return result
}
