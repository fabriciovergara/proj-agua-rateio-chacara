import { beforeEach, describe, expect, test } from 'bun:test'
import { type DB, openDatabase } from '#/db/client.server'
import { createOwner } from './owners.server'
import { createProperty } from './properties.server'
import {
  createReading,
  getMonthSheet,
  getPropertySheet,
  listHistory,
  saveMonthReadings,
  setPaid,
  updateReading,
} from './readings.server'

const TODAY = '2026-10-12'
const OCT = { year: 2026, month: 10 }
const NOV = { year: 2026, month: 11 }
const RATES = { kwhPriceMicros: 350000, reserveFundCents: 1000 }

let db: DB
let helena: number
let otavio: number

function property(name: string, ownerId: number | null = null) {
  return createProperty(db, {
    name,
    ownerId,
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

beforeEach(() => {
  db = openDatabase(':memory:')
  const owner = createOwner(db, {
    name: 'Helena',
    document: '',
    phone: '',
    email: '',
    notes: '',
  })
  helena = property('Chácara 14', owner.id)
  otavio = property('Chácara 15')
})

describe('monthly readings', () => {
  test('first reading needs the previous value, later months chain automatically', () => {
    expect(() =>
      saveMonthReadings(
        db,
        {
          ...OCT,
          rates: RATES,
          entries: [{ propertyId: helena, currentReading: 461 }],
        },
        TODAY,
      ),
    ).toThrow('informe também a leitura anterior')

    saveMonthReadings(
      db,
      {
        ...OCT,
        rates: RATES,
        entries: [
          { propertyId: helena, currentReading: 461, previousReading: 366 },
        ],
      },
      TODAY,
    )
    const october = getMonthSheet(db, OCT)
    const row = october.rows.find((r) => r.property.id === helena)
    expect(row?.reading?.bill).toEqual({
      consumption: 95,
      energyCents: 3325,
      reserveFundCents: 1000,
      totalCents: 4325,
    })
    expect(row?.owner?.name).toBe('Helena')

    const november = getMonthSheet(db, NOV)
    expect(
      november.rows.find((r) => r.property.id === helena)
        ?.suggestedPreviousReading,
    ).toBe(461)

    saveMonthReadings(
      db,
      {
        ...NOV,
        rates: RATES,
        entries: [{ propertyId: helena, currentReading: 512 }],
      },
      TODAY,
    )
    const saved = getMonthSheet(db, NOV).rows.find(
      (r) => r.property.id === helena,
    )
    expect(saved?.reading?.previousReading).toBe(461)
    expect(saved?.reading?.bill.consumption).toBe(51)
  })

  test('rejects a reading lower than the previous one', () => {
    expect(() =>
      saveMonthReadings(
        db,
        {
          ...OCT,
          rates: RATES,
          entries: [
            { propertyId: otavio, currentReading: 100, previousReading: 162 },
          ],
        },
        TODAY,
      ),
    ).toThrow('é menor que a anterior')
  })

  test('a new month suggests the values of the month before', () => {
    expect(getMonthSheet(db, OCT).rates).toBeNull()
    saveMonthReadings(
      db,
      {
        ...OCT,
        rates: RATES,
        entries: [
          { propertyId: otavio, currentReading: 170, previousReading: 162 },
        ],
      },
      TODAY,
    )
    expect(getMonthSheet(db, OCT).rates).toMatchObject({
      ...RATES,
      saved: true,
      suggestedFrom: null,
    })
    expect(getMonthSheet(db, NOV).rates).toMatchObject({
      ...RATES,
      saved: false,
      suggestedFrom: OCT,
    })
  })

  test('correcting a month also fixes the next month that followed it', () => {
    saveMonthReadings(
      db,
      {
        ...OCT,
        rates: RATES,
        entries: [
          { propertyId: helena, currentReading: 1234, previousReading: 1200 },
        ],
      },
      TODAY,
    )
    saveMonthReadings(
      db,
      {
        ...NOV,
        rates: RATES,
        entries: [{ propertyId: helena, currentReading: 1300 }],
      },
      TODAY,
    )
    // Typo fixed: October was 1243, not 1234.
    saveMonthReadings(
      db,
      {
        ...OCT,
        rates: RATES,
        entries: [{ propertyId: helena, currentReading: 1243 }],
      },
      TODAY,
    )
    const november = getMonthSheet(db, NOV).rows.find(
      (r) => r.property.id === helena,
    )
    expect(november?.reading?.previousReading).toBe(1243)
    expect(november?.reading?.bill.consumption).toBe(57)
  })

  test('summarises totals and payments', () => {
    saveMonthReadings(
      db,
      {
        ...OCT,
        rates: RATES,
        entries: [
          { propertyId: helena, currentReading: 461, previousReading: 366 },
          { propertyId: otavio, currentReading: 162, previousReading: 162 },
        ],
      },
      TODAY,
    )
    const sheet = getMonthSheet(db, OCT)
    const otavioReading = sheet.rows.find(
      (r) => r.property.id === otavio,
    )?.reading
    expect(otavioReading).toBeTruthy()
    setPaid(db, { id: otavioReading?.id ?? 0, paid: true }, TODAY)

    const summary = getMonthSheet(db, OCT).summary
    expect(summary).toMatchObject({
      readCount: 2,
      paidCount: 1,
      totalCents: 4325 + 1000,
      paidCents: 1000,
      pendingCents: 4325,
    })
  })

  test('changing the month values re-prices unpaid bills only', () => {
    saveMonthReadings(
      db,
      {
        ...OCT,
        rates: RATES,
        entries: [
          { propertyId: helena, currentReading: 461, previousReading: 366 },
          { propertyId: otavio, currentReading: 170, previousReading: 162 },
        ],
      },
      TODAY,
    )
    const otavioReading = getMonthSheet(db, OCT).rows.find(
      (r) => r.property.id === otavio,
    )?.reading
    setPaid(db, { id: otavioReading?.id ?? 0, paid: true }, TODAY)

    const newRates = { kwhPriceMicros: 400000, reserveFundCents: 1500 }
    const result = saveMonthReadings(
      db,
      { ...OCT, rates: newRates, entries: [] },
      TODAY,
    )
    expect(result).toEqual({ saved: 0, repriced: 1 })

    const rows = getMonthSheet(db, OCT).rows
    const helenaBill = rows.find((r) => r.property.id === helena)?.reading
    const otavioBill = rows.find((r) => r.property.id === otavio)?.reading
    expect(helenaBill?.bill.totalCents).toBe(95 * 40 + 1500)
    // Already paid: keeps what was charged.
    expect(otavioBill?.bill.totalCents).toBe(8 * 35 + 1000)

    // Saving the same values again changes nothing.
    expect(
      saveMonthReadings(db, { ...OCT, rates: newRates, entries: [] }, TODAY),
    ).toEqual({ saved: 0, repriced: 0 })
  })
})

describe('chácara spreadsheet', () => {
  test('suggests the next month and previous reading for a new row', () => {
    createReading(
      db,
      {
        propertyId: helena,
        ...OCT,
        previousReading: 366,
        currentReading: 461,
        kwhPriceMicros: 340000,
        reserveFundCents: 1000,
        paid: true,
      },
      TODAY,
    )
    const sheet = getPropertySheet(db, helena)
    // The first reading of October set October's values; November follows.
    expect(sheet?.newRow).toMatchObject({
      ...NOV,
      previousReading: 461,
      kwhPriceMicros: 340000,
    })
    expect(sheet?.readings[0]?.paidAt).toBe(TODAY)
  })

  test('editing a row keeps the chain and reports duplicates in Portuguese', () => {
    const oct = createReading(
      db,
      {
        propertyId: helena,
        ...OCT,
        previousReading: 100,
        currentReading: 150,
        kwhPriceMicros: 350000,
        reserveFundCents: 1000,
        paid: false,
      },
      TODAY,
    )
    createReading(
      db,
      {
        propertyId: helena,
        ...NOV,
        previousReading: 150,
        currentReading: 200,
        kwhPriceMicros: 350000,
        reserveFundCents: 1000,
        paid: false,
      },
      TODAY,
    )
    const result = updateReading(
      db,
      {
        id: oct?.reading.id ?? 0,
        ...OCT,
        previousReading: 100,
        currentReading: 160,
        kwhPriceMicros: 350000,
        reserveFundCents: 1000,
        paid: false,
      },
      TODAY,
    )
    expect(result?.relinked).toEqual(NOV)

    expect(() =>
      updateReading(
        db,
        {
          id: oct?.reading.id ?? 0,
          ...NOV,
          previousReading: 100,
          currentReading: 160,
          kwhPriceMicros: 350000,
          reserveFundCents: 1000,
          paid: false,
        },
        TODAY,
      ),
    ).toThrow('Já existe uma leitura deste mês')

    expect(() =>
      updateReading(
        db,
        {
          id: oct?.reading.id ?? 0,
          ...OCT,
          previousReading: 100,
          currentReading: 250,
          kwhPriceMicros: 350000,
          reserveFundCents: 1000,
          paid: false,
        },
        TODAY,
      ),
    ).toThrow('Corrija Novembro de 2026 primeiro')
  })
})

describe('history', () => {
  test('filters by status and orders newest first', () => {
    saveMonthReadings(
      db,
      {
        ...OCT,
        rates: RATES,
        entries: [
          { propertyId: helena, currentReading: 461, previousReading: 366 },
          { propertyId: otavio, currentReading: 170, previousReading: 162 },
        ],
      },
      TODAY,
    )
    saveMonthReadings(
      db,
      {
        ...NOV,
        rates: RATES,
        entries: [{ propertyId: helena, currentReading: 500 }],
      },
      TODAY,
    )
    const all = listHistory(db, {})
    expect(all.map((r) => [r.month, r.property.name])).toEqual([
      [11, 'Chácara 14'],
      [10, 'Chácara 14'],
      [10, 'Chácara 15'],
    ])
    expect(listHistory(db, { status: 'pago' })).toHaveLength(0)
    expect(listHistory(db, { propertyId: otavio })).toHaveLength(1)
  })
})

describe('leitura anterior off the chain', () => {
  const october = {
    ...OCT,
    previousReading: 700,
    currentReading: 800,
    kwhPriceMicros: 350000,
    reserveFundCents: 1000,
    paid: false,
  }

  test('a typo in the previous reading must be confirmed', () => {
    createReading(db, { propertyId: helena, ...october }, TODAY)
    const november = {
      propertyId: helena,
      ...NOV,
      previousReading: 80,
      currentReading: 900,
      kwhPriceMicros: 350000,
      reserveFundCents: 1000,
      paid: false,
    }
    expect(() => createReading(db, november, TODAY)).toThrow(
      'A leitura anterior (80) é diferente da leitura de Outubro de 2026 (800)',
    )
    // A new meter starting from zero is legitimate once confirmed.
    const result = createReading(
      db,
      { ...november, previousReading: 0, confirmPreviousChange: true },
      TODAY,
    )
    expect(result?.reading.previousReading).toBe(0)
  })

  test('editing only asks when the previous reading itself changes', () => {
    createReading(db, { propertyId: helena, ...october }, TODAY)
    // Imported rows can already be off the chain: editing other fields works.
    const nov = createReading(
      db,
      {
        propertyId: helena,
        ...NOV,
        previousReading: 790,
        currentReading: 850,
        kwhPriceMicros: 350000,
        reserveFundCents: 1000,
        paid: false,
        confirmPreviousChange: true,
      },
      TODAY,
    )
    const id = nov?.reading.id ?? 0
    const base = {
      id,
      ...NOV,
      currentReading: 850,
      kwhPriceMicros: 350000,
      reserveFundCents: 1000,
    }
    expect(
      updateReading(db, { ...base, previousReading: 790, paid: true }, TODAY)
        ?.reading.paid,
    ).toBe(true)
    expect(() =>
      updateReading(db, { ...base, previousReading: 780, paid: true }, TODAY),
    ).toThrow('diferente da leitura de Outubro de 2026')
    // Putting it back on the chain needs no confirmation.
    expect(
      updateReading(db, { ...base, previousReading: 800, paid: true }, TODAY)
        ?.reading.previousReading,
    ).toBe(800)
  })
})
