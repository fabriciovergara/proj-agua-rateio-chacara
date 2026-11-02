import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { type DB, openDatabase } from '#/db/client.server'
import { properties } from '#/db/schema'
import { createPeriod } from './periods.server'
import { createProperty } from './properties.server'
import { savePeriodSheet } from './readings.server'
import {
  deleteTankReading,
  getTankPage,
  listTankReadings,
  saveTankReading,
} from './tank.server'

const TODAY = '2026-11-02'
const SEP = { startDate: '2026-08-10', endDate: '2026-09-10' }
const OCT = { startDate: '2026-09-10', endDate: '2026-10-10' }

let db: DB

beforeEach(() => {
  db = openDatabase(':memory:')
})

const save = (date: string, liters: number, extra = {}) =>
  saveTankReading(db, { date, liters, ...extra }, TODAY)

const readings = () =>
  listTankReadings(db).map(({ date, liters, meterReplaced }) => ({
    date,
    liters,
    meterReplaced,
  }))

function chacara(name: string) {
  return createProperty(db, {
    name,
    ownerId: null,
    street: '',
    number: '',
    district: '',
    city: '',
    state: '',
    zipCode: '',
    meterNumber: '',
    active: true,
    notes: '',
  }).id
}

describe('readings of the caixa d’água', () => {
  test('must fit among the others by date', () => {
    save('2026-09-10', 1_200_000)
    save('2026-08-10', 1_000_000)
    expect(() => save('2026-09-10', 1_250_000)).toThrow(
      'Já existe uma leitura da caixa d’água em 10/09/2026',
    )
    expect(() => save('2026-08-20', 1_250_000)).toThrow(
      'é maior que a de 10/09/2026 (1.200)',
    )
    expect(() => save('2026-11-10', 1_300_000)).toThrow('é depois de hoje')
    expect(() => save('2026-10-10', 1_100_500)).toThrow(
      'é menor que a de 10/09/2026 (1.200)',
    )
    // Lower only with a new meter.
    save('2026-10-10', 25_000, { meterReplaced: true })
    expect(readings()).toEqual([
      { date: '2026-08-10', liters: 1_000_000, meterReplaced: false },
      { date: '2026-09-10', liters: 1_200_000, meterReplaced: false },
      { date: '2026-10-10', liters: 25_000, meterReplaced: true },
    ])
  })

  test('a new meter is only kept when the reading is lower', () => {
    save('2026-08-10', 1_000_000)
    save('2026-09-10', 1_200_000, { meterReplaced: true })
    expect(readings().at(-1)?.meterReplaced).toBe(false)
  })

  test('a correction is checked against the other readings', () => {
    save('2026-08-10', 1_000_000)
    const sep = save('2026-09-10', 1_200_000)
    save('2026-10-10', 1_380_000)
    saveTankReading(
      db,
      { id: sep.id, date: '2026-09-12', liters: 1_210_000 },
      TODAY,
    )
    expect(readings()[1]).toEqual({
      date: '2026-09-12',
      liters: 1_210_000,
      meterReplaced: false,
    })
    expect(() =>
      saveTankReading(
        db,
        { id: sep.id, date: '2026-09-12', liters: 1_400_000 },
        TODAY,
      ),
    ).toThrow('é maior que a de 10/10/2026 (1.380)')
    expect(() =>
      saveTankReading(db, { id: 999, date: '2026-09-12', liters: 1 }, TODAY),
    ).toThrow('Leitura da caixa d’água não encontrada.')
  })

  test('without the new meter’s first reading, the next one starts again', () => {
    save('2026-08-10', 1_000_000)
    const swap = save('2026-09-10', 5000, { meterReplaced: true })
    save('2026-10-10', 185_000)

    deleteTankReading(db, swap.id)
    // 185 m³ after 1.000 m³: the meter was replaced in between.
    expect(readings()).toEqual([
      { date: '2026-08-10', liters: 1_000_000, meterReplaced: false },
      { date: '2026-10-10', liters: 185_000, meterReplaced: true },
    ])
  })

  test('correcting the reading before a new meter can undo the swap', () => {
    // 1.200 m³ after 5.000 m³: only a new meter explains it…
    const typo = save('2026-01-10', 5_000_000)
    save('2026-02-10', 1_200_000, { meterReplaced: true })
    // …until the 5.000 turns out to be a typo for 1.000.
    saveTankReading(
      db,
      { id: typo.id, date: '2026-01-10', liters: 1_000_000 },
      TODAY,
    )
    expect(readings()).toEqual([
      { date: '2026-01-10', liters: 1_000_000, meterReplaced: false },
      { date: '2026-02-10', liters: 1_200_000, meterReplaced: false },
    ])
  })

  test('moving the new meter’s reading marks the one that follows', () => {
    save('2026-08-10', 1_000_000)
    const swap = save('2026-09-10', 5000, { meterReplaced: true })
    save('2026-10-10', 185_000)
    saveTankReading(
      db,
      { id: swap.id, date: '2026-10-20', liters: 190_000 },
      TODAY,
    )
    expect(readings()).toEqual([
      { date: '2026-08-10', liters: 1_000_000, meterReplaced: false },
      { date: '2026-10-10', liters: 185_000, meterReplaced: true },
      { date: '2026-10-20', liters: 190_000, meterReplaced: false },
    ])
  })
})

describe('getTankPage', () => {
  /** Chácara 1 uses 90 and 80 m³, Chácara 2 70 and 60 m³. */
  function readChacaras() {
    const ids = [chacara('Chácara 1'), chacara('Chácara 2')]
    // Their meters on 10/08, 10/09 and 10/10.
    const meters = [
      [0, 90, 170],
      [0, 70, 130],
    ]
    for (const [index, range] of [SEP, OCT].entries()) {
      const period = createPeriod(db, range)
      savePeriodSheet(db, {
        periodId: period.id,
        period: { ...range, energyBillCents: null, reserveFundCents: 1000 },
        entries: ids.map((propertyId, which) => ({
          propertyId,
          previousReading: meters[which]?.[index] ?? 0,
          currentReading: meters[which]?.[index + 1] ?? 0,
          ...range,
        })),
      })
    }
  }

  test('compares each stretch of the tank with the chácaras', () => {
    readChacaras()
    save('2026-08-10', 1_000_000)
    save('2026-09-10', 1_170_400)
    save('2026-10-10', 1_350_000)

    const page = getTankPage(db, TODAY)
    expect(page.rows.map((row) => row.date)).toEqual([
      '2026-10-10',
      '2026-09-10',
      '2026-08-10',
    ])
    const [oct, sep, first] = page.rows
    expect(first?.since).toBeNull()
    // 170,4 m³ against 90 + 70.
    expect(sep?.since).toMatchObject({
      consumption: 170,
      chacaras: { consumption: 160, estimated: false },
      result: { difference: 10, verdict: 'normal' },
    })
    // 179,6 m³ against 80 + 60.
    expect(oct?.since).toMatchObject({
      consumption: 180,
      chacaras: { consumption: 140 },
      result: { difference: 40, verdict: 'vazamento' },
    })
    expect(page.averages).toMatchObject({
      startDate: '2026-08-10',
      endDate: '2026-10-10',
      tankPerMonth: 175,
      chacarasPerMonth: 150,
    })
  })

  test('the newest reading waits for the chácaras’ readings', () => {
    readChacaras()
    save('2026-10-10', 1_000_000)
    save('2026-11-01', 1_150_000)
    const registered = (name: string, on: string) =>
      db
        .update(properties)
        .set({ createdAt: new Date(`${on}T12:00:00-03:00`) })
        .where(eq(properties.id, chacara(name)))
        .run()
    registered('Chácara 3', '2026-10-20')
    // Registered after the reading: not expected in it.
    registered('Chácara 4', '2026-11-02')

    const [newest] = getTankPage(db, TODAY).rows
    expect(newest?.since).toMatchObject({
      consumption: 150,
      chacaras: null,
      // Chácaras 1 and 2 stop on 10/10; Chácara 3 was never read.
      missing: ['Chácara 1', 'Chácara 2', 'Chácara 3'],
      result: null,
    })
  })
})
