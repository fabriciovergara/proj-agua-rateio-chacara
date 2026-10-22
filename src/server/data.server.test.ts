import { expect, test } from 'bun:test'
import { openDatabase } from '#/db/client.server'
import {
  appPassword,
  bankAccount,
  monthRates,
  owners,
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
  db.insert(readings)
    .values(
      [1, 2].map((month) => ({
        propertyId: chacara.id,
        year: 2026,
        month,
        previousReading: 100 * month,
        currentReading: 100 * month + 50,
        kwhPriceMicros: 850_000,
        reserveFundCents: 1500,
      })),
    )
    .run()
  db.insert(monthRates)
    .values({
      year: 2026,
      month: 2,
      kwhPriceMicros: 850_000,
      reserveFundCents: 1500,
    })
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
    months: 0,
    settings: false,
    bank: false,
  })
  fillIn(db)
  expect(dataSummary(db)).toEqual({
    properties: 1,
    owners: 2,
    readings: 2,
    months: 1,
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
    months: 0,
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
  expect([owner.id, chacara.id]).toEqual([1, 1])
})
