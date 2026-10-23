import { describe, expect, test } from 'bun:test'
import { openDatabase } from '#/db/client.server'
import { getChartData } from './charts.server'
import { createPeriod } from './periods.server'
import { createProperty } from './properties.server'
import { savePeriodSheet } from './readings.server'

const MARCH = { startDate: '2026-02-10', endDate: '2026-03-10' }

function setup(count: number) {
  const db = openDatabase(':memory:')
  const ids = Array.from(
    { length: count },
    (_, index) =>
      createProperty(db, {
        name: `Chácara ${index + 1}`,
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
      }).id,
  )
  const period = createPeriod(db, MARCH)
  const consumption = ids.reduce((sum, _, index) => sum + (index + 1) * 10, 0)
  // R$ 0,50 per m³.
  savePeriodSheet(db, {
    periodId: period.id,
    period: {
      ...MARCH,
      energyBillCents: consumption * 50,
      reserveFundCents: 1000,
    },
    entries: ids.map((propertyId, index) => ({
      propertyId,
      previousReading: 0,
      currentReading: (index + 1) * 10,
      ...MARCH,
    })),
  })
  return { db, ids, period }
}

describe('getChartData', () => {
  test('a chácara keeps its colour when the chart is filtered', () => {
    const { db, ids } = setup(3)
    const all = getChartData(db, { year: 2026 })
    const third = ids[2] ?? 0
    const filtered = getChartData(db, { year: 2026, propertyId: third })
    expect(all.series.find((s) => s.id === third)?.slot).toBe(2)
    expect(filtered.series).toEqual([{ id: third, name: 'Chácara 3', slot: 2 }])
  })

  test('folds chácaras past the 8th colour into "Outras"', () => {
    const { db } = setup(10)
    const data = getChartData(db, { year: 2026 })
    expect(data.series).toHaveLength(8)
    expect(data.series.at(-1)).toEqual({ id: 0, name: 'Outras', slot: 7 })
    const [march] = data.byPeriod
    // Chácaras 8, 9 and 10 used 80 + 90 + 100 m³ at R$ 0,50.
    expect(march?.energyBySeries[0]).toBe(270 * 50)
    expect(march?.energyCents).toBe(550 * 50)
  })

  test('summarises the periods of the year', () => {
    const { db, period } = setup(2)
    createPeriod(db, { startDate: '2025-11-10', endDate: '2025-12-10' })
    const data = getChartData(db, { year: 2026 })
    expect(data.byPeriod.map((p) => p.id)).toEqual([period.id])
    expect(data.totals).toMatchObject({
      consumption: 30,
      energyCents: 1500,
      billCents: 1500,
      pendingCents: 1500 + 2000,
    })
    expect(data.byProperty.map((p) => p.consumption)).toEqual([20, 10])
    // Without a year: the last 12 periods.
    expect(getChartData(db, {}).byPeriod).toHaveLength(2)
  })
})
