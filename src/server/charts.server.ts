import { asc } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import { periods, properties } from '#/db/schema'
import { yearOf } from '#/lib/periods'
import { presentReadings } from './readings.server'

/** Charts use at most 8 colours; extra chácaras are grouped as "Outras". */
export const MAX_SERIES = 8
export const OTHERS_ID = 0

export interface ChartFilters {
  /** The periods ending in a year, or the last 12 periods when absent. */
  year?: number
  propertyId?: number
}

export function getChartData(db: Executor, filters: ChartFilters) {
  const all = db.select().from(periods).orderBy(asc(periods.startDate)).all()
  const chosen = filters.year
    ? all.filter((period) => yearOf(period.endDate) === filters.year)
    : all.slice(-12)
  const chosenIds = new Set(chosen.map((period) => period.id))

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

  const rows = [
    ...presentReadings(
      db,
      filters.propertyId ? [filters.propertyId] : undefined,
    ).values(),
  ].filter((reading) => chosenIds.has(reading.periodId))

  const byPeriod = chosen.map((period) => {
    const inPeriod = rows.filter((r) => r.periodId === period.id)
    const energyBySeries: Record<string, number> = {}
    for (const s of series) energyBySeries[s.id] = 0
    let paidCents = 0
    let pendingCents = 0
    let consumption = 0
    let energyCents = 0
    for (const r of inPeriod) {
      const id = seriesIdOf(r.propertyId)
      const energy = r.bill.energyCents ?? 0
      energyBySeries[id] = (energyBySeries[id] ?? 0) + energy
      energyCents += energy
      consumption += r.bill.consumption
      if (r.paid) paidCents += r.bill.totalCents ?? 0
      else pendingCents += r.bill.totalCents ?? 0
    }
    return {
      id: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      /** The pump's electricity bill (null until it is typed in). */
      billCents: period.energyBillCents,
      readings: inPeriod.length,
      energyBySeries,
      energyCents,
      consumption,
      paidCents,
      pendingCents,
    }
  })

  const byProperty = shown
    .map((property) => {
      const own = rows.filter((r) => r.propertyId === property.id)
      return {
        id: property.id,
        name: property.name,
        consumption: own.reduce((sum, r) => sum + r.bill.consumption, 0),
        energyCents: own.reduce((sum, r) => sum + (r.bill.energyCents ?? 0), 0),
        readings: own.length,
      }
    })
    .filter((p) => p.readings > 0)
    .sort((a, b) => b.consumption - a.consumption)

  const totals = rows.reduce(
    (acc, r) => {
      const amount = r.bill.totalCents ?? 0
      acc.consumption += r.bill.consumption
      acc.energyCents += r.bill.energyCents ?? 0
      acc.totalCents += amount
      if (r.paid) {
        acc.paidCents += amount
        acc.reserveFundPaidCents += r.bill.reserveFundCents
      } else {
        acc.pendingCents += amount
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
    series,
    byPeriod,
    byProperty,
    totals: {
      ...totals,
      /** The electricity bills of the periods shown. */
      billCents: chosen.reduce((sum, p) => sum + (p.energyBillCents ?? 0), 0),
    },
    readingsCount: rows.length,
  }
}

export type ChartData = ReturnType<typeof getChartData>
