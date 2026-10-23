import { expect, test } from 'bun:test'
import { openDatabase } from '#/db/client.server'
import {
  appPassword,
  bankAccount,
  owners,
  periods,
  properties,
  readings,
  sessions,
  settings,
} from '#/db/schema'
import { createSession, setAppPassword } from './auth.server'
import { dataSummary, deleteAllData } from './data.server'

/** Fictitious data only. */
function fillIn(db: ReturnType<typeof openDatabase>) {
  const owner = db
    .insert(owners)
    .values({ name: 'Zuleica Fictícia' })
    .returning()
    .get()
  db.insert(owners).values({ name: 'Quirino Exemplo' }).run()
  const chacara = db
    .insert(properties)
    .values({ name: 'Chácara 7', ownerId: owner.id })
    .returning()
    .get()
  const months = db
    .insert(periods)
    .values([
      {
        startDate: '2025-12-10',
        endDate: '2026-01-10',
        energyBillCents: 4000,
        reserveFundCents: 1500,
      },
      {
        startDate: '2026-01-10',
        endDate: '2026-02-10',
        energyBillCents: 4000,
        reserveFundCents: 1500,
      },
    ])
    .returning()
    .all()
  db.insert(readings)
    .values(
      months.map((period, index) => ({
        propertyId: chacara.id,
        periodId: period.id,
        previousReading: 100 * (index + 1),
        currentReading: 100 * (index + 1) + 50,
        energyCents: 4000,
        reserveFundCents: 1500,
      })),
    )
    .run()
  db.insert(settings).values({ id: 1, groupName: 'Grupo Exemplo' }).run()
  db.insert(bankAccount).values({ id: 1, bankName: 'Banco Exemplo' }).run()
}

test('counts what the app has', () => {
  const db = openDatabase(':memory:')
  expect(dataSummary(db)).toEqual({
    properties: 0,
    owners: 0,
    readings: 0,
    periods: 0,
    settings: false,
    bank: false,
  })
  fillIn(db)
  expect(dataSummary(db)).toEqual({
    properties: 1,
    owners: 2,
    readings: 2,
    periods: 2,
    settings: true,
    bank: true,
  })
})

test('wiping deletes all the data but not the passwords or sessions', async () => {
  const db = openDatabase(':memory:')
  await setAppPassword(db, { current: '', password: 'chacara-15' })
  createSession(db)
  fillIn(db)

  deleteAllData(db)

  expect(dataSummary(db)).toEqual({
    properties: 0,
    owners: 0,
    readings: 0,
    periods: 0,
    settings: false,
    bank: false,
  })
  expect(db.select().from(appPassword).all()).toHaveLength(1)
  expect(db.select().from(sessions).all()).toHaveLength(1)
})

test('after wiping, new records are numbered from 1 again', () => {
  const db = openDatabase(':memory:')
  fillIn(db)
  deleteAllData(db)

  const owner = db
    .insert(owners)
    .values({ name: 'Dona Exemplo' })
    .returning()
    .get()
  const chacara = db
    .insert(properties)
    .values({ name: 'Chácara 9' })
    .returning()
    .get()
  const period = db
    .insert(periods)
    .values({
      startDate: '2026-01-10',
      endDate: '2026-02-10',
      reserveFundCents: 0,
    })
    .returning()
    .get()
  expect([owner.id, chacara.id, period.id]).toEqual([1, 1, 1])
})
