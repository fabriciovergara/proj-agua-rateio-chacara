import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import { properties, readings } from '#/db/schema'
import {
  addMonths,
  currentPeriod,
  formatPeriodShort,
  type Period,
  periodKey,
} from '#/lib/periods'
import { withBill } from './readings.server'

/** Charts use at most 8 colours; extra chácaras are grouped as "Outras". */
export const MAX_SERIES = 8
export const OTHERS_ID = 0

const periodIndex = sql<number>`${readings.year} * 12 + ${readings.month}`
const indexOf = (period: Period) => period.year * 12 + period.month

export interface ChartFilters {
  /** A calendar year, or the last 12 months when absent. */
  year?: number
  propertyId?: number
}

export function getChartData(db: Executor, filters: ChartFilters) {
  const end = filters.year ? { year: filters.year, month: 12 } : currentPeriod()
  const periods = Array.from({ length: 12 }, (_, i) => addMonths(end, i - 11))
  const [first] = periods

  // Colours follow the chácara (creation order), never its ranking.
  const allProperties = db
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .orderBy(asc(properties.id))
    .all()
  const foldTail = allProperties.length > MAX_SERIES
  const slotOf = new Map(
    allProperties.map((property, index) => [
      property.id,
      foldTail ? Math.min(index, MAX_SERIES - 1) : index,
    ]),
  )
  const shown = filters.propertyId
    ? allProperties.filter((p) => p.id === filters.propertyId)
    : allProperties
  const folded = !filters.propertyId && foldTail
  const series = (folded ? shown.slice(0, MAX_SERIES - 1) : shown).map(
    (property) => ({ ...property, slot: slotOf.get(property.id) ?? 0 }),
  )
  if (folded) {
    series.push({ id: OTHERS_ID, name: 'Outras', slot: MAX_SERIES - 1 })
  }
  const seriesIdOf = (propertyId: number) =>
    series.some((s) => s.id === propertyId) ? propertyId : OTHERS_ID

  const rows = db
    .select()
    .from(readings)
    .where(
      and(
        gte(periodIndex, indexOf(first ?? end)),
        lte(periodIndex, indexOf(end)),
        filters.propertyId
          ? eq(readings.propertyId, filters.propertyId)
          : undefined,
      ),
    )
    .all()
    .map(withBill)

  const monthly = periods.map((period) => {
    const inMonth = rows.filter(
      (r) => r.year === period.year && r.month === period.month,
    )
    const energyBySeries: Record<string, number> = {}
    for (const s of series) energyBySeries[s.id] = 0
    let paidCents = 0
    let pendingCents = 0
    let consumption = 0
    let energyCents = 0
    for (const r of inMonth) {
      const id = seriesIdOf(r.propertyId)
      energyBySeries[id] = (energyBySeries[id] ?? 0) + r.bill.energyCents
      energyCents += r.bill.energyCents
      consumption += r.bill.consumption
      if (r.paid) paidCents += r.bill.totalCents
      else pendingCents += r.bill.totalCents
    }
    // The price most readings of the month were billed with.
    const prices = new Map<number, number>()
    for (const r of inMonth) {
      prices.set(r.kwhPriceMicros, (prices.get(r.kwhPriceMicros) ?? 0) + 1)
    }
    const kwhPriceMicros =
      [...prices.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    return {
      key: periodKey(period),
      label: formatPeriodShort(period),
      ...period,
      readings: inMonth.length,
      energyBySeries,
      energyCents,
      consumption,
      paidCents,
      pendingCents,
      kwhPriceMicros,
    }
  })

  const byProperty = shown
    .map((property) => {
      const own = rows.filter((r) => r.propertyId === property.id)
      return {
        id: property.id,
        name: property.name,
        consumption: own.reduce((sum, r) => sum + r.bill.consumption, 0),
        energyCents: own.reduce((sum, r) => sum + r.bill.energyCents, 0),
        readings: own.length,
      }
    })
    .filter((p) => p.readings > 0)
    .sort((a, b) => b.consumption - a.consumption)

  const totals = rows.reduce(
    (acc, r) => {
      acc.consumption += r.bill.consumption
      acc.energyCents += r.bill.energyCents
      acc.totalCents += r.bill.totalCents
      if (r.paid) {
        acc.paidCents += r.bill.totalCents
        acc.reserveFundPaidCents += r.bill.reserveFundCents
      } else {
        acc.pendingCents += r.bill.totalCents
      }
      return acc
    },
    {
      consumption: 0,
      energyCents: 0,
      totalCents: 0,
      paidCents: 0,
      pendingCents: 0,
      reserveFundPaidCents: 0,
    },
  )

  return {
    periods,
    series,
    monthly,
    byProperty,
    totals,
    readingsCount: rows.length,
  }
}

export type ChartData = ReturnType<typeof getChartData>
