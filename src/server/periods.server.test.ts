import { beforeEach, describe, expect, test } from 'bun:test'
import { type DB, openDatabase } from '#/db/client.server'
import { readings } from '#/db/schema'
import {
  createPeriod,
  deletePeriod,
  getPeriod,
  listPeriods,
  periodCounts,
  savePeriodValues,
} from './periods.server'
import { createProperty } from './properties.server'
import { savePeriodSheet } from './readings.server'

const SEP = { startDate: '2026-08-10', endDate: '2026-09-10' }
const OCT = { startDate: '2026-09-10', endDate: '2026-10-10' }

let db: DB

beforeEach(() => {
  db = openDatabase(':memory:')
})

const values = (
  range: { startDate: string; endDate: string },
  extra: { energyBillCents?: number | null; reserveFundCents?: number } = {},
) => ({ energyBillCents: null, reserveFundCents: 1000, ...range, ...extra })

describe('periods', () => {
  test('may start the day the one before ends, never overlap it', () => {
    createPeriod(db, SEP)
    createPeriod(db, OCT)
    expect(() =>
      createPeriod(db, { startDate: '2026-10-01', endDate: '2026-11-10' }),
    ).toThrow('se sobrepõem ao período de 10/09/2026 a 10/10/2026')
    expect(() =>
      createPeriod(db, { startDate: '2026-11-10', endDate: '2026-11-10' }),
    ).toThrow('A data final precisa ser depois da inicial.')
    expect(listPeriods(db).map((p) => p.startDate)).toEqual([
      OCT.startDate,
      SEP.startDate,
    ])
  })

  test('a new period keeps the reserve fund of the one before', () => {
    const sep = createPeriod(db, SEP)
    savePeriodValues(db, sep.id, values(SEP, { reserveFundCents: 1500 }))
    expect(createPeriod(db, OCT)).toMatchObject({
      energyBillCents: null,
      reserveFundCents: 1500,
    })
    // Older than all the others: the fund of the one after it.
    expect(
      createPeriod(db, { startDate: '2026-07-10', endDate: '2026-08-10' }),
    ).toMatchObject({ reserveFundCents: 1500 })
  })

  test('moving a date moves the neighbour that touches it', () => {
    const sep = createPeriod(db, SEP)
    const oct = createPeriod(db, OCT)

    savePeriodValues(
      db,
      sep.id,
      values({ startDate: SEP.startDate, endDate: '2026-09-12' }),
    )
    expect(getPeriod(db, oct.id)?.startDate).toBe('2026-09-12')

    savePeriodValues(
      db,
      oct.id,
      values({ startDate: '2026-09-08', endDate: OCT.endDate }),
    )
    expect(getPeriod(db, sep.id)?.endDate).toBe('2026-09-08')

    expect(() =>
      savePeriodValues(
        db,
        oct.id,
        values({ startDate: '2026-08-01', endDate: OCT.endDate }),
      ),
    ).toThrow('começaria antes do período anterior')
  })

  test('a period with a gap before it cannot grow into its neighbour', () => {
    const sep = createPeriod(db, SEP)
    const nov = createPeriod(db, {
      startDate: '2026-10-10',
      endDate: '2026-11-10',
    })
    expect(() =>
      savePeriodValues(
        db,
        nov.id,
        values({ startDate: '2026-09-01', endDate: '2026-11-10' }),
      ),
    ).toThrow('se sobrepõem ao período de 10/08/2026 a 10/09/2026')
    expect(getPeriod(db, sep.id)?.endDate).toBe(SEP.endDate)
  })

  test('readings follow the period’s dates unless they have their own', () => {
    const sep = createPeriod(db, SEP)
    const chacara = createProperty(db, {
      name: 'Chácara 7',
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
    })
    savePeriodSheet(db, {
      periodId: sep.id,
      period: values(SEP),
      entries: [
        {
          propertyId: chacara.id,
          previousReading: 1,
          currentReading: 9,
          startDate: SEP.startDate,
          endDate: '2026-09-12',
        },
      ],
    })
    // The period now ends when that chácara was read: it just follows it.
    savePeriodValues(
      db,
      sep.id,
      values({ startDate: SEP.startDate, endDate: '2026-09-12' }),
    )
    expect(db.select({ end: readings.endDate }).from(readings).all()).toEqual([
      { end: null },
    ])
  })

  test('deleting a period deletes its readings', () => {
    const sep = createPeriod(db, SEP)
    const chacara = createProperty(db, {
      name: 'Chácara 7',
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
    })
    savePeriodSheet(db, {
      periodId: sep.id,
      period: values(SEP),
      entries: [
        {
          propertyId: chacara.id,
          previousReading: 1,
          currentReading: 9,
          ...SEP,
        },
      ],
    })
    expect(periodCounts(db, sep.id)).toEqual({ readings: 1, paid: 0 })
    deletePeriod(db, sep.id)
    expect(db.select().from(readings).all()).toHaveLength(0)
  })
})
