import { Database } from 'bun:sqlite'
import { describe, expect, spyOn, test } from 'bun:test'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { type DB, MIGRATIONS_FOLDER, openDatabase } from '#/db/client.server'
import {
  appPassword,
  bankAccount,
  owners,
  periods,
  properties,
  readings,
  settings,
} from '#/db/schema'
import { createSession, setAppPassword } from './auth.server'
import { createBackup, importBackup, readBackup } from './backup.server'
import { deleteAllData } from './data.server'
import { createOwner } from './owners.server'

const JAN = { startDate: '2025-12-10', endDate: '2026-01-10' }
const FEB = { startDate: '2026-01-10', endDate: '2026-02-10' }

test('the backup is a complete SQLite database, without sessions', async () => {
  const db = openDatabase(':memory:')
  createOwner(db, {
    name: 'Ana',
    document: '',
    phone: '',
    email: '',
    notes: '',
  })

  await setAppPassword(db, { current: '', password: 'chacara-15' })
  createSession(db)

  const bytes = await createBackup(db)
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rateio-test-'))
  try {
    const file = path.join(directory, 'copy.sqlite')
    writeFileSync(file, new Uint8Array(bytes))
    const copy = new Database(file, { readonly: true })
    expect(copy.query('select name from owners').all()).toEqual([
      { name: 'Ana' },
    ])
    // Keeps the password, leaves out the unlocked devices.
    expect(copy.query('select count(*) as n from app_password').get()).toEqual({
      n: 1,
    })
    expect(copy.query('select count(*) as n from sessions').get()).toEqual({
      n: 0,
    })
    copy.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

/** An app with a bit of everything. Fictitious people only. */
async function sourceApp() {
  const db = openDatabase(':memory:')
  await setAppPassword(db, { current: '', password: 'chacara-15' })
  const [zuleica, apagada, , teodora] = db
    .insert(owners)
    .values([
      { name: 'Zuleica Fictícia', phone: '(11) 90000-0001', notes: 'Portão' },
      { name: 'Apagada Exemplo' },
      // A proprietário without a chácara.
      { name: 'Quirino Exemplo', email: 'quirino@example.com' },
      { name: 'Teodora Exemplo' },
    ])
    .returning()
    .all()
  // Leaves a gap in the numbers.
  db.delete(owners)
    .where(eq(owners.id, apagada?.id ?? 0))
    .run()
  const [sete, nove, onze] = db
    .insert(properties)
    .values([
      {
        name: 'Chácara 7',
        ownerId: zuleica?.id,
        meterNumber: 'H-0007',
        street: 'Rua Exemplo',
        city: 'Cidade Exemplo',
      },
      { name: 'Chácara 9', ownerId: teodora?.id, active: false },
      { name: 'Chácara 11', meterNumber: 'H-0011' },
    ])
    .returning()
    .all()
  const [jan, feb] = db
    .insert(periods)
    .values([
      { ...JAN, energyBillCents: 5000, reserveFundCents: 1500 },
      { ...FEB, energyBillCents: 6000, reserveFundCents: 1500 },
    ])
    .returning()
    .all()
  const reading = (
    propertyId: number | undefined,
    periodId: number | undefined,
    previousReading: number,
    currentReading: number,
    energyCents: number,
  ) => ({
    propertyId: propertyId ?? 0,
    periodId: periodId ?? 0,
    previousReading,
    currentReading,
    energyCents,
    reserveFundCents: 1500,
  })
  db.insert(readings)
    .values([
      {
        ...reading(sete?.id, jan?.id, 100, 150, 3570),
        paid: true,
        paidAt: '2026-02-10',
        endDate: '2026-01-12',
        notes: 'Conferida',
      },
      reading(sete?.id, feb?.id, 150, 190, 4000),
      reading(nove?.id, jan?.id, 10, 30, 1430),
      reading(onze?.id, feb?.id, 500, 520, 2000),
    ])
    .run()
  db.insert(settings)
    .values({ id: 1, groupName: 'Grupo Exemplo', dueDay: 10 })
    .run()
  db.insert(bankAccount)
    .values({
      id: 1,
      bankName: 'Banco Exemplo',
      pixKeyType: 'email',
      pixKey: 'pix@example.com',
      holderName: 'Grupo Exemplo',
      holderCity: 'Cidade Exemplo',
    })
    .run()
  return db
}

const backupOf = async (db: DB) => new Uint8Array(await createBackup(db))

/** Everything a backup brings, in a stable order. */
const contents = (db: DB) => ({
  owners: db.select().from(owners).orderBy(asc(owners.id)).all(),
  properties: db.select().from(properties).orderBy(asc(properties.id)).all(),
  readings: db.select().from(readings).orderBy(asc(readings.id)).all(),
  periods: db.select().from(periods).orderBy(asc(periods.id)).all(),
  settings: db.select().from(settings).all(),
  bank: db.select().from(bankAccount).all(),
})

/** The backup changed with plain SQL, as another version could have it. */
function editBackup(bytes: Uint8Array, edit: (copy: Database) => void) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rateio-test-'))
  try {
    const file = path.join(directory, 'copy.sqlite')
    writeFileSync(file, bytes)
    const copy = new Database(file)
    edit(copy)
    copy.close()
    return new Uint8Array(readFileSync(file))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('importing a backup', () => {
  test('into an app wiped clean, it comes back exactly as it was', async () => {
    const source = await sourceApp()
    const bytes = await backupOf(source)

    const target = openDatabase(':memory:')
    await setAppPassword(target, { current: '', password: 'outra-senha' })
    const password = target.select().from(appPassword).get()
    // Data typed in before and wiped: numbers already used don't matter.
    target
      .insert(owners)
      .values([{ name: 'Dona Exemplo' }, { name: 'Seu Exemplo' }])
      .run()
    deleteAllData(target)

    expect(importBackup(target, readBackup(bytes))).toEqual({
      created: 3,
      matched: 0,
      readings: 4,
      existing: 0,
      skipped: [],
      owners: 3,
      periods: 2,
      settings: true,
      bank: true,
    })
    expect(contents(target)).toEqual(contents(source))
    // The copy's password stays out.
    expect(target.select().from(appPassword).get()).toEqual(password)
  })

  test('into an app with data, only what it lacks comes in', async () => {
    const backup = readBackup(await backupOf(await sourceApp()))
    const target = openDatabase(':memory:')
    const [dona] = target
      .insert(owners)
      .values([{ name: 'Dona Exemplo' }, { name: 'teodora  exemplo' }])
      .returning()
      .all()
    const typed = target
      .insert(properties)
      .values({ name: 'chacara  7', ownerId: dona?.id })
      .returning()
      .get()
    // January typed in the app, with its own bill.
    const january = target
      .insert(periods)
      .values({ ...JAN, energyBillCents: 8000, reserveFundCents: 2000 })
      .returning()
      .get()
    target
      .insert(readings)
      .values({
        propertyId: typed.id,
        periodId: january.id,
        previousReading: 100,
        currentReading: 160,
        energyCents: 8000,
        reserveFundCents: 2000,
      })
      .run()
    target.insert(settings).values({ id: 1, groupName: 'Outro grupo' }).run()

    expect(importBackup(target, backup)).toEqual({
      created: 2,
      matched: 1,
      readings: 3,
      existing: 1,
      skipped: [],
      owners: 1,
      periods: 1,
      settings: false,
      bank: true,
    })

    // The chácara typed in keeps its owner and its January; February came.
    expect(
      target
        .select({ period: readings.periodId, current: readings.currentReading })
        .from(readings)
        .where(eq(readings.propertyId, typed.id))
        .orderBy(asc(readings.periodId))
        .all(),
    ).toEqual([
      { period: january.id, current: 160 },
      { period: january.id + 1, current: 190 },
    ])
    expect(
      target.select().from(properties).where(eq(properties.id, typed.id)).get()
        ?.ownerId,
    ).toBe(dona?.id ?? -1)
    // Chácara 9 gets the proprietário the app already had; the one without
    // a chácara comes; the owner of the chácara already there doesn't.
    expect(
      target
        .select({ name: properties.name, owner: owners.name })
        .from(properties)
        .leftJoin(owners, eq(owners.id, properties.ownerId))
        .orderBy(asc(properties.id))
        .all(),
    ).toEqual([
      { name: 'chacara  7', owner: 'Dona Exemplo' },
      { name: 'Chácara 9', owner: 'teodora  exemplo' },
      { name: 'Chácara 11', owner: null },
    ])
    expect(
      target
        .select({ name: owners.name })
        .from(owners)
        .orderBy(asc(owners.id))
        .all(),
    ).toEqual([
      { name: 'Dona Exemplo' },
      { name: 'teodora  exemplo' },
      { name: 'Quirino Exemplo' },
    ])
    // Values the app already had stay; January's bill is split again with
    // the chácara that came: 60 and 20 m³.
    expect(target.select().from(settings).get()?.groupName).toBe('Outro grupo')
    expect(
      target
        .select({
          bill: periods.energyBillCents,
          fund: periods.reserveFundCents,
        })
        .from(periods)
        .orderBy(asc(periods.startDate))
        .all(),
    ).toEqual([
      { bill: 8000, fund: 2000 },
      { bill: 6000, fund: 1500 },
    ])
    expect(
      target
        .select({
          energy: readings.energyCents,
          fund: readings.reserveFundCents,
        })
        .from(readings)
        .where(eq(readings.periodId, january.id))
        .orderBy(asc(readings.id))
        .all(),
    ).toEqual([
      { energy: 6000, fund: 2000 },
      { energy: 2000, fund: 2000 },
    ])

    // The same copy again adds nothing.
    expect(importBackup(target, backup)).toEqual({
      created: 0,
      matched: 3,
      readings: 0,
      existing: 4,
      skipped: [],
      owners: 0,
      periods: 0,
      settings: false,
      bank: false,
    })
  })

  test('a period whose dates overlap one of the app is left out', async () => {
    const backup = readBackup(await backupOf(await sourceApp()))
    const target = openDatabase(':memory:')
    target
      .insert(periods)
      .values({
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        reserveFundCents: 1000,
      })
      .run()

    const result = importBackup(target, backup)

    expect(result.skipped).toEqual([
      'Período de 10/12/2025 a 10/01/2026: o app tem o período de 01/01/2026 a 01/02/2026 nessas datas; as leituras dele não foram importadas',
      'Período de 10/01/2026 a 10/02/2026: o app tem o período de 01/01/2026 a 01/02/2026 nessas datas; as leituras dele não foram importadas',
    ])
    expect(result).toMatchObject({ created: 3, readings: 0, periods: 0 })
  })

  /** The copy with a second "Chácara 7", which has a March reading. */
  async function backupWithTwinChacara() {
    const backup = readBackup(await backupOf(await sourceApp()))
    const [sete] = backup.properties
    const [reading] = backup.readings
    const [period] = backup.periods
    if (!sete || !reading || !period) {
      throw new Error('A cópia de teste tem a Chácara 7.')
    }
    backup.periods.push({
      ...period,
      id: 3,
      startDate: '2026-02-10',
      endDate: '2026-03-10',
    })
    backup.properties.push({ ...sete, id: 99, meterNumber: null })
    backup.readings.push({ ...reading, id: 99, propertyId: 99, periodId: 3 })
    return backup
  }

  test('chácaras that can be confused are reported, not guessed', async () => {
    const backup = await backupWithTwinChacara()
    const target = openDatabase(':memory:')
    target
      .insert(properties)
      .values([
        { name: 'Chácara 7' },
        { name: 'Chácara 9' },
        { name: 'Chácara 9' },
      ])
      .run()

    const result = importBackup(target, backup)

    expect(result.skipped).toEqual([
      'Chácara 9: o app tem mais de uma chácara com esse nome ou hidrômetro; as leituras dela não foram importadas',
      'Chácara 7: a cópia tem outra chácara com esse nome ou hidrômetro; as leituras dela não foram importadas',
    ])
    // The first Chácara 7 and Chácara 11 come with their readings.
    expect(result).toMatchObject({ created: 1, matched: 1, readings: 3 })
    expect(
      target.select().from(readings).where(eq(readings.periodId, 3)).all(),
    ).toHaveLength(0)
  })

  test('an empty app gets chácaras with the same name, as in the copy', async () => {
    const target = openDatabase(':memory:')
    const result = importBackup(target, await backupWithTwinChacara())

    expect(result).toMatchObject({ created: 4, readings: 5, skipped: [] })
    expect(
      target
        .select({ id: properties.id, name: properties.name })
        .from(properties)
        .where(eq(properties.name, 'Chácara 7'))
        .all(),
    ).toEqual([
      { id: 1, name: 'Chácara 7' },
      { id: 99, name: 'Chácara 7' },
    ])
  })
})

/**
 * A copy made by the app when readings were kept by month (migrations
 * 0000 to 0003), with a gap in February.
 */
function monthlyCopy(): Uint8Array {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rateio-test-'))
  try {
    const folder = path.join(directory, 'drizzle')
    mkdirSync(path.join(folder, 'meta'), { recursive: true })
    const journal = JSON.parse(
      readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter((entry) => entry.tag < '0004')
    writeFileSync(
      path.join(folder, 'meta/_journal.json'),
      JSON.stringify(journal),
    )
    for (const { tag } of journal.entries) {
      copyFileSync(
        path.join(MIGRATIONS_FOLDER, `${tag}.sql`),
        path.join(folder, `${tag}.sql`),
      )
    }

    const sqlite = new Database(':memory:')
    migrate(drizzle({ client: sqlite }), { migrationsFolder: folder })
    sqlite.run("INSERT INTO properties (id, name) VALUES (1, 'Chácara 7')")
    sqlite.run(
      `INSERT INTO readings (property_id, year, month, previous_reading, current_reading, kwh_price_micros, reserve_fund_cents, paid)
       VALUES (1, 2026, 1, 100, 150, 850000, 1500, 1), (1, 2026, 3, 150, 190, 870000, 1500, 0)`,
    )
    sqlite.run(
      `INSERT INTO month_rates (year, month, kwh_price_micros, reserve_fund_cents)
       VALUES (2026, 1, 850000, 1500), (2026, 3, 870000, 1500)`,
    )
    const bytes = sqlite.serialize()
    sqlite.close()
    return bytes
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('reading a backup', () => {
  test('refuses files that are not a backup of the app', () => {
    const notABackup =
      'Este arquivo não é uma cópia de segurança do Rateio da Água.'
    expect(() =>
      readBackup(new TextEncoder().encode('isto não é um banco')),
    ).toThrow(notABackup)

    const other = new Database(':memory:')
    other.run('CREATE TABLE notas (texto TEXT)')
    expect(() => readBackup(other.serialize())).toThrow(notABackup)
    other.close()

    const damaged = new Uint8Array(4096)
    damaged.set(new TextEncoder().encode('SQLite format 3\0'))
    expect(() => readBackup(damaged)).toThrow(
      'Não foi possível ler a cópia de segurança.',
    )
  })

  test('a copy made by months, before periods, comes as periods', () => {
    const backup = readBackup(monthlyCopy())

    expect(
      backup.periods.map(({ startDate, endDate, energyBillCents }) => ({
        startDate,
        endDate,
        energyBillCents,
      })),
    ).toEqual([
      // January 2026, then March 2026 billed with February.
      { startDate: '2025-12-10', endDate: '2026-01-10', energyBillCents: 4250 },
      { startDate: '2026-01-10', endDate: '2026-03-10', energyBillCents: 3480 },
    ])
    // Each reading keeps what it charged: m³ × its price (the old
    // kwh_price_micros column, which was really per m³).
    expect(
      backup.readings.map(({ energyCents, reserveFundCents, paid }) => ({
        energyCents,
        reserveFundCents,
        paid,
      })),
    ).toEqual([
      { energyCents: 4250, reserveFundCents: 1500, paid: true },
      { energyCents: 3480, reserveFundCents: 1500, paid: false },
    ])
  })

  test('a copy from a newer version is refused', async () => {
    const newer = editBackup(await backupOf(await sourceApp()), (copy) => {
      copy.run(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('futura', ?)",
        [Date.now() + 365 * 86_400_000],
      )
    })
    expect(() => readBackup(newer)).toThrow(
      'Esta cópia foi feita por uma versão mais nova do app.',
    )
  })

  test('a copy the app cannot accept imports nothing', async () => {
    const backup = readBackup(await backupOf(await sourceApp()))
    const first = backup.readings[0]
    if (!first) throw new Error('A cópia de teste tem leituras.')
    first.currentReading = first.previousReading - 1
    const target = openDatabase(':memory:')
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => importBackup(target, backup)).toThrow(
        'A cópia tem dados que o app não aceita. Nada foi importado.',
      )
    } finally {
      log.mockRestore()
    }
    expect(target.select().from(properties).all()).toHaveLength(0)
    expect(target.select().from(settings).all()).toHaveLength(0)
  })
})
