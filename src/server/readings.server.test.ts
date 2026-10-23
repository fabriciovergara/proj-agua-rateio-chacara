import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { type DB, openDatabase } from '#/db/client.server'
import { periods, readings } from '#/db/schema'
import type { PropertyInput } from '#/lib/schemas'
import { createOwner } from './owners.server'
import { createPeriod } from './periods.server'
import { createProperty, updateProperty } from './properties.server'
import {
  createReading,
  deleteReading,
  getPeriodSheet,
  getPropertySheet,
  listHistory,
  savePeriodSheet,
  setPaid,
  updateReading,
} from './readings.server'

const TODAY = '2026-10-12'
const AUG = { startDate: '2026-07-10', endDate: '2026-08-10' }
const SEP = { startDate: '2026-08-10', endDate: '2026-09-10' }
const OCT = { startDate: '2026-09-10', endDate: '2026-10-10' }

let db: DB
/** Chácara 14 (Helena's) and Chácara 15. */
let c14: number
let c15: number

const blankProperty: PropertyInput = {
  name: '',
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
}

function property(name: string, ownerId: number | null = null) {
  return createProperty(db, { ...blankProperty, name, ownerId }).id
}

type Entry = {
  propertyId: number
  previousReading: number
  currentReading: number
  startDate?: string
  endDate?: string
  meterReplaced?: boolean
}

/** Saves the Leituras screen of a period, as the browser does. */
function save(
  periodId: number,
  entries: Entry[],
  values: { energyBillCents?: number | null; reserveFundCents?: number } = {},
) {
  const period = db.select().from(periods).where(eq(periods.id, periodId)).get()
  if (!period) throw new Error('no period')
  return savePeriodSheet(db, {
    periodId,
    period: {
      startDate: period.startDate,
      endDate: period.endDate,
      energyBillCents:
        values.energyBillCents === undefined
          ? period.energyBillCents
          : values.energyBillCents,
      reserveFundCents: values.reserveFundCents ?? period.reserveFundCents,
    },
    entries: entries.map((entry) => ({
      startDate: period.startDate,
      endDate: period.endDate,
      ...entry,
    })),
  })
}

function readingOf(propertyId: number, periodId: number) {
  return getPropertySheet(db, propertyId)?.readings.find(
    (reading) => reading.periodId === periodId,
  )
}

beforeEach(() => {
  db = openDatabase(':memory:')
  const owner = createOwner(db, {
    name: 'Helena',
    document: '',
    phone: '',
    email: '',
    notes: '',
  })
  c14 = property('Chácara 14', owner.id)
  c15 = property('Chácara 15')
})

describe('the rateio of a period', () => {
  test('splits the electricity bill by the m³ each one used, plus the fund', () => {
    const sep = createPeriod(db, SEP).id
    // R$ 300,00 for 10 + 20 m³: R$ 10,00 per m³.
    save(
      sep,
      [
        { propertyId: c14, previousReading: 100, currentReading: 110 },
        { propertyId: c15, previousReading: 50, currentReading: 70 },
      ],
      { energyBillCents: 30_000, reserveFundCents: 1000 },
    )

    expect(readingOf(c14, sep)?.bill).toEqual({
      consumption: 10,
      energyCents: 10_000,
      reserveFundCents: 1000,
      totalCents: 11_000,
    })
    expect(readingOf(c15, sep)?.bill.totalCents).toBe(21_000)
  })

  test('readings can be saved before the bill arrives', () => {
    const sep = createPeriod(db, SEP).id
    save(sep, [{ propertyId: c14, previousReading: 100, currentReading: 110 }])
    const reading = readingOf(c14, sep)
    expect(reading?.bill.totalCents).toBeNull()
    expect(() =>
      setPaid(db, { id: reading?.id ?? 0, paid: true }, TODAY),
    ).toThrow('conta de energia')

    save(sep, [], { energyBillCents: 4500 })
    expect(readingOf(c14, sep)?.bill.energyCents).toBe(4500)
  })

  test('each new reading splits the bill again; paid bills keep theirs', () => {
    const sep = createPeriod(db, SEP).id
    save(
      sep,
      [{ propertyId: c14, previousReading: 100, currentReading: 110 }],
      { energyBillCents: 30_000, reserveFundCents: 1000 },
    )
    const first = readingOf(c14, sep)
    expect(first?.bill.energyCents).toBe(30_000)
    setPaid(db, { id: first?.id ?? 0, paid: true }, TODAY)

    save(sep, [{ propertyId: c15, previousReading: 50, currentReading: 70 }])
    expect(readingOf(c14, sep)?.bill.energyCents).toBe(30_000)
    expect(readingOf(c15, sep)?.bill.energyCents).toBe(20_000)

    // Undone, it follows the split again.
    setPaid(db, { id: first?.id ?? 0, paid: false }, TODAY)
    expect(readingOf(c14, sep)?.bill.energyCents).toBe(10_000)
  })

  test('a new bill or fund changes the unpaid bills only', () => {
    const sep = createPeriod(db, SEP).id
    save(
      sep,
      [
        { propertyId: c14, previousReading: 100, currentReading: 110 },
        { propertyId: c15, previousReading: 50, currentReading: 60 },
      ],
      { energyBillCents: 2000, reserveFundCents: 1000 },
    )
    setPaid(db, { id: readingOf(c14, sep)?.id ?? 0, paid: true }, TODAY)
    save(sep, [], { energyBillCents: 4000, reserveFundCents: 1500 })

    expect(readingOf(c14, sep)?.bill).toMatchObject({
      energyCents: 1000,
      reserveFundCents: 1000,
    })
    expect(readingOf(c15, sep)?.bill).toMatchObject({
      energyCents: 2000,
      reserveFundCents: 1500,
    })
  })

  test('deleting a reading splits the bill among the others', () => {
    const sep = createPeriod(db, SEP).id
    save(
      sep,
      [
        { propertyId: c14, previousReading: 100, currentReading: 110 },
        { propertyId: c15, previousReading: 50, currentReading: 60 },
      ],
      { energyBillCents: 2000 },
    )
    deleteReading(db, readingOf(c15, sep)?.id ?? 0)
    expect(readingOf(c14, sep)?.bill.energyCents).toBe(2000)
  })

  test('rejects a reading lower than the última leitura', () => {
    const sep = createPeriod(db, SEP).id
    expect(() =>
      save(sep, [
        { propertyId: c15, previousReading: 162, currentReading: 100 },
      ]),
    ).toThrow('não pode ser menor que a última leitura')
  })
})

describe('Última leitura', () => {
  test('comes from the previous period, and correcting it corrects that one', () => {
    const aug = createPeriod(db, AUG).id
    const sep = createPeriod(db, SEP).id
    save(
      aug,
      [
        { propertyId: c14, previousReading: 100, currentReading: 110 },
        { propertyId: c15, previousReading: 50, currentReading: 60 },
      ],
      { energyBillCents: 2000 },
    )
    const sheet = getPeriodSheet(db, sep, TODAY)
    expect(
      sheet.rows.find((row) => row.property.id === c14)?.previous
        ?.currentReading,
    ).toBe(110)

    const result = save(sep, [
      { propertyId: c14, previousReading: 112, currentReading: 130 },
    ])

    expect(result?.relinked).toEqual([{ property: 'Chácara 14', ...AUG }])
    expect(readingOf(c14, aug)?.currentReading).toBe(112)
    expect(readingOf(c14, sep)?.previousReading).toBe(112)
    // August is split again: 12 + 10 m³.
    expect(readingOf(c14, aug)?.bill.energyCents).toBe(1091)
    expect(readingOf(c15, aug)?.bill.energyCents).toBe(909)
  })

  test('a paid bill keeps what it charged when its reading is corrected', () => {
    const aug = createPeriod(db, AUG).id
    const sep = createPeriod(db, SEP).id
    save(
      aug,
      [{ propertyId: c14, previousReading: 100, currentReading: 110 }],
      { energyBillCents: 2000 },
    )
    setPaid(db, { id: readingOf(c14, aug)?.id ?? 0, paid: true }, TODAY)
    save(sep, [{ propertyId: c14, previousReading: 115, currentReading: 130 }])

    expect(readingOf(c14, aug)).toMatchObject({
      currentReading: 115,
      paid: true,
      bill: { consumption: 15, energyCents: 2000 },
    })
  })

  test('cannot go below the previous reading’s own última leitura', () => {
    const aug = createPeriod(db, AUG).id
    const sep = createPeriod(db, SEP).id
    save(aug, [{ propertyId: c14, previousReading: 100, currentReading: 110 }])
    expect(() =>
      save(sep, [{ propertyId: c14, previousReading: 0, currentReading: 12 }]),
    ).toThrow('se o hidrômetro foi trocado, confirme a troca')
  })

  test('a replaced meter starts from its own number', () => {
    const aug = createPeriod(db, AUG).id
    const sep = createPeriod(db, SEP).id
    const oct = createPeriod(db, OCT).id
    save(aug, [{ propertyId: c14, previousReading: 100, currentReading: 110 }])
    save(sep, [
      {
        propertyId: c14,
        previousReading: 0,
        currentReading: 12,
        meterReplaced: true,
      },
    ])
    expect(readingOf(c14, aug)?.currentReading).toBe(110)
    expect(readingOf(c14, sep)?.bill.consumption).toBe(12)

    // Correcting September later leaves August alone too.
    save(sep, [{ propertyId: c14, previousReading: 2, currentReading: 12 }])
    expect(readingOf(c14, aug)?.currentReading).toBe(110)
    save(oct, [{ propertyId: c14, previousReading: 12, currentReading: 20 }])
    expect(readingOf(c14, oct)?.bill.consumption).toBe(8)
  })

  test('correcting Leitura atual corrects the next Última leitura', () => {
    const aug = createPeriod(db, AUG).id
    const sep = createPeriod(db, SEP).id
    save(aug, [{ propertyId: c14, previousReading: 100, currentReading: 110 }])
    save(sep, [{ propertyId: c14, previousReading: 110, currentReading: 130 }])

    const result = save(aug, [
      { propertyId: c14, previousReading: 100, currentReading: 108 },
    ])
    expect(result?.relinked).toEqual([{ property: 'Chácara 14', ...SEP }])
    expect(readingOf(c14, sep)?.previousReading).toBe(108)

    expect(() =>
      save(aug, [
        { propertyId: c14, previousReading: 100, currentReading: 140 },
      ]),
    ).toThrow('Corrija aquela leitura primeiro')
  })
})

describe('dates', () => {
  test('a chácara can have its own dates', () => {
    const sep = createPeriod(db, SEP).id
    const oct = createPeriod(db, OCT).id
    save(sep, [
      {
        propertyId: c14,
        previousReading: 100,
        currentReading: 110,
        endDate: '2026-09-12',
      },
      { propertyId: c15, previousReading: 50, currentReading: 60 },
    ])
    expect(readingOf(c14, sep)).toMatchObject({
      startDate: SEP.startDate,
      endDate: '2026-09-12',
    })
    // Stored only when different from the period's.
    expect(db.select({ end: readings.endDate }).from(readings).all()).toEqual([
      { end: '2026-09-12' },
      { end: null },
    ])

    // The next reading starts when this one ended.
    save(oct, [
      {
        propertyId: c14,
        previousReading: 110,
        currentReading: 120,
        startDate: '2026-09-12',
      },
    ])
    expect(readingOf(c14, oct)).toMatchObject({
      startDate: '2026-09-12',
      endDate: OCT.endDate,
    })
  })

  test('a chácara skipped in a period spans both in the next', () => {
    const aug = createPeriod(db, AUG).id
    createPeriod(db, SEP)
    const oct = createPeriod(db, OCT).id
    save(aug, [{ propertyId: c14, previousReading: 100, currentReading: 110 }])
    save(oct, [
      {
        propertyId: c14,
        previousReading: 110,
        currentReading: 150,
        startDate: AUG.endDate,
      },
    ])
    expect(readingOf(c14, oct)).toMatchObject({
      startDate: AUG.endDate,
      endDate: OCT.endDate,
    })
    const sheet = getPeriodSheet(db, oct, TODAY)
    const row = sheet.rows.find((r) => r.property.id === c14)
    expect(row?.previous).toMatchObject({
      endDate: AUG.endDate,
      endsAtPeriodStart: false,
    })
  })

  test('moving the date of the última leitura moves the previous reading', () => {
    const aug = createPeriod(db, AUG).id
    const sep = createPeriod(db, SEP).id
    save(aug, [{ propertyId: c14, previousReading: 100, currentReading: 110 }])
    const result = save(sep, [
      {
        propertyId: c14,
        previousReading: 110,
        currentReading: 120,
        startDate: '2026-08-08',
      },
    ])
    expect(readingOf(c14, aug)?.endDate).toBe('2026-08-08')
    expect(readingOf(c14, sep)?.startDate).toBe('2026-08-08')
    expect(result?.relinked).toEqual([
      {
        property: 'Chácara 14',
        startDate: AUG.startDate,
        endDate: '2026-08-08',
      },
    ])

    expect(() =>
      save(sep, [
        {
          propertyId: c14,
          previousReading: 110,
          currentReading: 120,
          startDate: '2026-07-01',
        },
      ]),
    ).toThrow('ficaria antes da leitura anterior')
  })

  test('the first reading of a chácara keeps its own start', () => {
    const sep = createPeriod(db, SEP).id
    save(sep, [
      {
        propertyId: c14,
        previousReading: 100,
        currentReading: 110,
        startDate: '2026-08-01',
      },
    ])
    expect(readingOf(c14, sep)?.startDate).toBe('2026-08-01')
  })
})

describe('the Leituras screen', () => {
  test('shows active chácaras and inactive ones read in the period', () => {
    const sep = createPeriod(db, SEP).id
    const oct = createPeriod(db, OCT).id
    const old = property('Chácara 99')
    save(sep, [{ propertyId: old, previousReading: 1, currentReading: 5 }])
    updateProperty(db, old, {
      ...blankProperty,
      name: 'Chácara 99',
      active: false,
    })

    const names = (periodId: number) =>
      getPeriodSheet(db, periodId, TODAY).rows.map((row) => row.property.name)
    expect(names(sep)).toEqual(['Chácara 14', 'Chácara 15', 'Chácara 99'])
    expect(names(oct)).toEqual(['Chácara 14', 'Chácara 15'])
  })

  test('opens on the newest period and knows its neighbours', () => {
    expect(getPeriodSheet(db, undefined, TODAY).period).toBeNull()
    expect(getPeriodSheet(db, undefined, TODAY).newPeriod).toEqual({
      startDate: '2026-09-12',
      endDate: '2026-10-12',
    })

    const sep = createPeriod(db, SEP).id
    const oct = createPeriod(db, OCT).id
    const sheet = getPeriodSheet(db, undefined, TODAY)
    expect(sheet.period).toMatchObject({
      id: oct,
      previousId: sep,
      nextId: null,
    })
    expect(sheet.newPeriod).toEqual({
      startDate: OCT.endDate,
      endDate: '2026-11-10',
    })
    expect(sheet.periods.map((p) => p.id)).toEqual([oct, sep])
  })

  test('averages the recent consumption to catch typos', () => {
    const aug = createPeriod(db, AUG).id
    const sep = createPeriod(db, SEP).id
    const oct = createPeriod(db, OCT).id
    save(aug, [{ propertyId: c14, previousReading: 100, currentReading: 110 }])
    save(sep, [{ propertyId: c14, previousReading: 110, currentReading: 130 }])
    const row = getPeriodSheet(db, oct, TODAY).rows.find(
      (r) => r.property.id === c14,
    )
    expect(row?.averageConsumption).toBe(15)
  })
})

describe('a chácara’s page', () => {
  test('adds a reading in an earlier period, linking both sides', () => {
    const aug = createPeriod(db, AUG).id
    const sep = createPeriod(db, SEP).id
    const oct = createPeriod(db, OCT).id
    save(aug, [{ propertyId: c14, previousReading: 100, currentReading: 110 }])
    save(oct, [
      {
        propertyId: c14,
        previousReading: 110,
        currentReading: 150,
        startDate: AUG.endDate,
      },
    ])

    createReading(
      db,
      {
        propertyId: c14,
        periodId: sep,
        previousReading: 110,
        currentReading: 125,
        startDate: AUG.endDate,
        endDate: SEP.endDate,
        paid: false,
      },
      TODAY,
    )
    expect(readingOf(c14, oct)).toMatchObject({
      previousReading: 125,
      startDate: SEP.endDate,
    })
    expect(() =>
      createReading(
        db,
        {
          propertyId: c14,
          periodId: sep,
          previousReading: 110,
          currentReading: 125,
          startDate: AUG.endDate,
          endDate: SEP.endDate,
          paid: false,
        },
        TODAY,
      ),
    ).toThrow('já tem leitura neste período')
  })

  test('a reading before the first one becomes the one it follows', () => {
    const sep = createPeriod(db, SEP).id
    const oct = createPeriod(db, OCT).id
    save(oct, [{ propertyId: c14, previousReading: 110, currentReading: 130 }])

    const result = createReading(
      db,
      {
        propertyId: c14,
        periodId: sep,
        previousReading: 100,
        currentReading: 112,
        startDate: SEP.startDate,
        endDate: SEP.endDate,
        paid: false,
      },
      TODAY,
    )
    expect(result?.relinked).toEqual([{ property: 'Chácara 14', ...OCT }])
    expect(readingOf(c14, oct)).toMatchObject({
      previousReading: 112,
      startDate: SEP.endDate,
    })
    expect(() =>
      updateReading(
        db,
        {
          id: readingOf(c14, sep)?.id ?? 0,
          previousReading: 100,
          currentReading: 140,
          startDate: SEP.startDate,
          endDate: SEP.endDate,
          paid: false,
        },
        TODAY,
      ),
    ).toThrow('Corrija aquela leitura primeiro')
  })

  test('corrects a row and marks it paid', () => {
    const sep = createPeriod(db, SEP).id
    save(
      sep,
      [{ propertyId: c14, previousReading: 100, currentReading: 110 }],
      { energyBillCents: 5000 },
    )
    const reading = readingOf(c14, sep)
    updateReading(
      db,
      {
        id: reading?.id ?? 0,
        previousReading: 100,
        currentReading: 112,
        startDate: SEP.startDate,
        endDate: SEP.endDate,
        paid: true,
      },
      TODAY,
    )
    expect(readingOf(c14, sep)).toMatchObject({
      currentReading: 112,
      paid: true,
      paidAt: TODAY,
      bill: { energyCents: 5000 },
    })
  })
})

describe('history', () => {
  test('filters by the year the period ends in and by payment', () => {
    const dec = createPeriod(db, {
      startDate: '2025-12-10',
      endDate: '2026-01-10',
    }).id
    const sep = createPeriod(db, SEP).id
    save(dec, [{ propertyId: c14, previousReading: 90, currentReading: 100 }], {
      energyBillCents: 1000,
    })
    save(sep, [{ propertyId: c14, previousReading: 100, currentReading: 110 }])
    setPaid(db, { id: readingOf(c14, dec)?.id ?? 0, paid: true }, TODAY)

    expect(listHistory(db, {}).map((r) => r.periodId)).toEqual([sep, dec])
    expect(listHistory(db, { year: 2026 })).toHaveLength(2)
    expect(listHistory(db, { year: 2025 })).toHaveLength(0)
    expect(listHistory(db, { status: 'pago' }).map((r) => r.periodId)).toEqual([
      dec,
    ])
    expect(listHistory(db, { propertyId: c15 })).toHaveLength(0)
  })
})
