import { and, asc, desc, eq, gt, inArray, lt, ne, or, sql } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import {
  monthRates,
  owners,
  properties,
  type Reading,
  readings,
} from '#/db/schema'
import { computeBill } from '#/lib/billing'
import { translateDatabaseError, UserFacingError } from '#/lib/errors'
import { formatNumber } from '#/lib/money'
import {
  addMonths,
  comparePeriods,
  currentPeriod,
  formatPeriod,
  type Period,
} from '#/lib/periods'
import {
  type MonthEntriesInput,
  monthEntriesSchema,
  type ReadingInput,
  readingSchema,
  type UpdateReadingInput,
  updateReadingSchema,
} from '#/lib/schemas'

const byName = new Intl.Collator('pt-BR', {
  numeric: true,
  sensitivity: 'base',
})

const periodIndex = sql<number>`${readings.year} * 12 + ${readings.month}`
const indexOf = (period: Period) => period.year * 12 + period.month

export function withBill<T extends Reading>(reading: T) {
  return { ...reading, bill: computeBill(reading) }
}

const ownerSummary = { id: owners.id, name: owners.name, phone: owners.phone }

/** Readings before `period` per chácara, newest first. */
function historyBefore(
  db: Executor,
  propertyIds: number[],
  period: Period,
  excludeId?: number,
) {
  const history = new Map<number, Reading[]>()
  if (propertyIds.length === 0) return history
  const rows = db
    .select()
    .from(readings)
    .where(
      and(
        inArray(readings.propertyId, propertyIds),
        lt(periodIndex, indexOf(period)),
        excludeId === undefined ? undefined : ne(readings.id, excludeId),
      ),
    )
    .all()
    .sort((a, b) => comparePeriods(b, a))
  for (const row of rows) {
    const list = history.get(row.propertyId) ?? []
    list.push(row)
    history.set(row.propertyId, list)
  }
  return history
}

/** The most recent reading before `period`, per chácara. */
function latestBefore(
  db: Executor,
  propertyIds: number[],
  period: Period,
  excludeId?: number,
) {
  const latest = new Map<number, Reading>()
  for (const [propertyId, list] of historyBefore(
    db,
    propertyIds,
    period,
    excludeId,
  )) {
    const [newest] = list
    if (newest) latest.set(propertyId, newest)
  }
  return latest
}

/** Average consumption of the last 6 readings, to spot typos. */
function recentAverage(list: Reading[] | undefined): number | null {
  const recent = (list ?? []).slice(0, 6)
  if (recent.length === 0) return null
  const total = recent.reduce(
    (sum, r) => sum + (r.currentReading - r.previousReading),
    0,
  )
  return Math.round(total / recent.length)
}

function findReading(db: Executor, propertyId: number, period: Period) {
  return db
    .select()
    .from(readings)
    .where(
      and(
        eq(readings.propertyId, propertyId),
        eq(readings.year, period.year),
        eq(readings.month, period.month),
      ),
    )
    .get()
}

const ratesIndex = sql<number>`${monthRates.year} * 12 + ${monthRates.month}`

/** The kWh price and reserve fund saved for a month, if any. */
export function getMonthRates(db: Executor, period: Period) {
  return (
    db
      .select()
      .from(monthRates)
      .where(
        and(
          eq(monthRates.year, period.year),
          eq(monthRates.month, period.month),
        ),
      )
      .get() ?? null
  )
}

/**
 * The values to use for a month: the saved ones or, until the month is
 * saved, those of the latest earlier month (they rarely change).
 */
export function ratesFor(db: Executor, period: Period) {
  const saved = getMonthRates(db, period)
  const fallback =
    saved ??
    db
      .select()
      .from(monthRates)
      .where(lt(ratesIndex, indexOf(period)))
      .orderBy(desc(monthRates.year), desc(monthRates.month))
      .limit(1)
      .get() ??
    db
      .select()
      .from(monthRates)
      .orderBy(desc(monthRates.year), desc(monthRates.month))
      .limit(1)
      .get()
  if (!fallback) return null
  return {
    kwhPriceMicros: fallback.kwhPriceMicros,
    reserveFundCents: fallback.reserveFundCents,
    saved: saved !== null,
    /** Where a suggestion came from (null when the month has its own). */
    suggestedFrom: saved
      ? null
      : { year: fallback.year, month: fallback.month },
  }
}

/**
 * Saves a month's values. When they change, the month's unpaid bills follow;
 * paid bills keep what was charged. Returns how many bills were re-priced.
 */
function saveRates(
  db: Executor,
  period: Period,
  rates: { kwhPriceMicros: number; reserveFundCents: number },
) {
  const current = getMonthRates(db, period)
  if (
    current?.kwhPriceMicros === rates.kwhPriceMicros &&
    current.reserveFundCents === rates.reserveFundCents
  ) {
    return 0
  }
  db.insert(monthRates)
    .values({ ...period, ...rates })
    .onConflictDoUpdate({
      target: [monthRates.year, monthRates.month],
      set: { ...rates, updatedAt: new Date() },
    })
    .run()
  return db
    .update(readings)
    .set(rates)
    .where(
      and(
        eq(readings.year, period.year),
        eq(readings.month, period.month),
        eq(readings.paid, false),
        or(
          ne(readings.kwhPriceMicros, rates.kwhPriceMicros),
          ne(readings.reserveFundCents, rates.reserveFundCents),
        ),
      ),
    )
    .returning({ id: readings.id })
    .all().length
}

/**
 * "Leitura anterior" normally repeats the previous month's reading. A
 * different value is only legitimate when the meter was replaced or reset,
 * so it has to be confirmed explicitly (a typo there silently inflates the
 * bill).
 */
function assertChained(
  before: Reading | undefined,
  previousReading: number,
  confirmed: boolean | undefined,
) {
  if (!before || confirmed || before.currentReading === previousReading) return
  throw new UserFacingError(
    `A leitura anterior (${formatNumber(previousReading)}) é diferente da leitura de ${formatPeriod(before)} (${formatNumber(before.currentReading)}). Confira o número; ele só muda quando o hidrômetro é trocado.`,
  )
}

/**
 * Keeps the chain "leitura anterior = leitura atual do mês anterior" intact:
 * when a month's reading changes, the next month that was linked to the old
 * value follows the new one. Returns the period that was updated, if any.
 */
function relinkNext(
  db: Executor,
  propertyId: number,
  period: Period,
  oldValue: number | undefined,
  newValue: number,
): Period | null {
  if (oldValue === undefined || oldValue === newValue) return null
  const next = db
    .select()
    .from(readings)
    .where(
      and(
        eq(readings.propertyId, propertyId),
        gt(periodIndex, indexOf(period)),
      ),
    )
    .orderBy(asc(readings.year), asc(readings.month))
    .limit(1)
    .get()
  if (!next || next.previousReading !== oldValue) return null
  if (next.currentReading < newValue) {
    throw new UserFacingError(
      `A leitura de ${formatPeriod(next)} (${formatNumber(next.currentReading)}) ficaria menor que ${formatNumber(newValue)}. Corrija ${formatPeriod(next)} primeiro.`,
    )
  }
  db.update(readings)
    .set({ previousReading: newValue })
    .where(eq(readings.id, next.id))
    .run()
  return { year: next.year, month: next.month }
}

/** Everything the "Leituras do mês" screen needs. */
export function getMonthSheet(db: Executor, period: Period) {
  const monthReadings = db
    .select()
    .from(readings)
    .where(
      and(eq(readings.year, period.year), eq(readings.month, period.month)),
    )
    .all()
  const readingByProperty = new Map(
    monthReadings.map((reading) => [reading.propertyId, reading]),
  )

  const visible = db
    .select({ property: properties, owner: ownerSummary })
    .from(properties)
    .leftJoin(owners, eq(owners.id, properties.ownerId))
    .all()
    // Inactive chácaras only appear in months where they were billed.
    .filter(
      ({ property }) => property.active || readingByProperty.has(property.id),
    )
    .sort((a, b) => byName.compare(a.property.name, b.property.name))

  const previous = historyBefore(
    db,
    visible.map(({ property }) => property.id),
    period,
  )

  const rows = visible.map(({ property, owner }) => {
    const reading = readingByProperty.get(property.id)
    return {
      property: {
        id: property.id,
        name: property.name,
        meterNumber: property.meterNumber,
        active: property.active,
      },
      owner,
      reading: reading ? withBill(reading) : null,
      /** Used as "Leitura anterior" when the month has no reading yet. */
      suggestedPreviousReading:
        previous.get(property.id)?.[0]?.currentReading ?? null,
      averageConsumption: recentAverage(previous.get(property.id)),
    }
  })

  let totalCents = 0
  let paidCents = 0
  let paidCount = 0
  for (const { reading } of rows) {
    if (!reading) continue
    totalCents += reading.bill.totalCents
    if (reading.paid) {
      paidCents += reading.bill.totalCents
      paidCount++
    }
  }

  return {
    period,
    /** kWh price and reserve fund of the month (or a suggestion). */
    rates: ratesFor(db, period),
    rows,
    summary: {
      chacaras: rows.length,
      readCount: rows.filter((row) => row.reading).length,
      paidCount,
      totalCents,
      paidCents,
      pendingCents: totalCents - paidCents,
    },
  }
}

export type MonthSheet = ReturnType<typeof getMonthSheet>

/**
 * Saves the monthly screen: the month's values (kWh price and reserve fund)
 * and the readings typed for it (new or corrected).
 */
export function saveMonthReadings(
  db: Executor,
  input: MonthEntriesInput,
  today: string,
) {
  const { year, month, rates, entries } = monthEntriesSchema.parse(input)
  const period = { year, month }
  let saved = 0
  let repriced = 0

  try {
    db.transaction((tx) => {
      repriced = saveRates(tx, period, rates)
      for (const entry of entries) {
        const property = tx
          .select({ id: properties.id, name: properties.name })
          .from(properties)
          .where(eq(properties.id, entry.propertyId))
          .get()
        if (!property) throw new UserFacingError('Chácara não encontrada.')

        const existing = findReading(tx, property.id, period)
        if (existing) {
          if (existing.currentReading === entry.currentReading) continue
          if (entry.currentReading < existing.previousReading) {
            throw new UserFacingError(
              `${property.name}: a leitura atual (${formatNumber(entry.currentReading)}) é menor que a anterior (${formatNumber(existing.previousReading)}).`,
            )
          }
          tx.update(readings)
            .set({ currentReading: entry.currentReading })
            .where(eq(readings.id, existing.id))
            .run()
          relinkNext(
            tx,
            property.id,
            period,
            existing.currentReading,
            entry.currentReading,
          )
          saved++
          continue
        }

        const before = latestBefore(tx, [property.id], period).get(property.id)
        const previousReading = before?.currentReading ?? entry.previousReading
        if (previousReading === undefined) {
          throw new UserFacingError(
            `${property.name}: informe também a leitura anterior, porque é a primeira leitura desta chácara.`,
          )
        }
        if (entry.currentReading < previousReading) {
          throw new UserFacingError(
            `${property.name}: a leitura atual (${formatNumber(entry.currentReading)}) é menor que a anterior (${formatNumber(previousReading)}).`,
          )
        }
        tx.insert(readings)
          .values({
            propertyId: property.id,
            year,
            month,
            previousReading,
            currentReading: entry.currentReading,
            kwhPriceMicros: rates.kwhPriceMicros,
            reserveFundCents: rates.reserveFundCents,
            readingDate: today,
          })
          .run()
        relinkNext(
          tx,
          property.id,
          period,
          before?.currentReading,
          entry.currentReading,
        )
        saved++
      }
    })
  } catch (error) {
    translateDatabaseError(error)
  }
  return { saved, repriced }
}

export function setPaid(
  db: Executor,
  input: { id: number; paid: boolean },
  today: string,
) {
  const updated = db
    .update(readings)
    .set({ paid: input.paid, paidAt: input.paid ? today : null })
    .where(eq(readings.id, input.id))
    .returning()
    .get()
  if (!updated) throw new UserFacingError('Leitura não encontrada.')
  return updated
}

/** The spreadsheet of one chácara ("Execução do programa"). */
export function getPropertySheet(db: Executor, propertyId: number) {
  const row = db
    .select({ property: properties, owner: ownerSummary })
    .from(properties)
    .leftJoin(owners, eq(owners.id, properties.ownerId))
    .where(eq(properties.id, propertyId))
    .get()
  if (!row) return null

  const history = db
    .select()
    .from(readings)
    .where(eq(readings.propertyId, propertyId))
    .orderBy(asc(readings.year), asc(readings.month))
    .all()
    .map(withBill)

  const last = history.at(-1)
  const nextPeriod = last ? addMonths(last, 1) : currentPeriod()
  const rates = ratesFor(db, nextPeriod)

  return {
    property: row.property,
    owner: row.owner,
    readings: history,
    newRow: {
      ...nextPeriod,
      previousReading: last?.currentReading ?? null,
      kwhPriceMicros: rates?.kwhPriceMicros ?? null,
      reserveFundCents: rates?.reserveFundCents ?? null,
    },
  }
}

export function createReading(
  db: Executor,
  input: ReadingInput,
  today: string,
) {
  const { confirmPreviousChange, ...values } = readingSchema.parse(input)
  const period = { year: values.year, month: values.month }
  try {
    return db.transaction((tx) => {
      const property = tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, values.propertyId))
        .get()
      if (!property) throw new UserFacingError('Chácara não encontrada.')

      const before = latestBefore(tx, [values.propertyId], period).get(
        values.propertyId,
      )
      assertChained(before, values.previousReading, confirmPreviousChange)
      const reading = tx
        .insert(readings)
        .values({
          ...values,
          paidAt: values.paid ? today : null,
          readingDate: today,
        })
        .returning()
        .get()
      // The first reading of a month also sets the month's values.
      if (!getMonthRates(tx, period)) {
        tx.insert(monthRates)
          .values({
            ...period,
            kwhPriceMicros: values.kwhPriceMicros,
            reserveFundCents: values.reserveFundCents,
          })
          .run()
      }
      const relinked = relinkNext(
        tx,
        values.propertyId,
        period,
        before?.currentReading,
        values.currentReading,
      )
      return { reading, relinked }
    })
  } catch (error) {
    translateDatabaseError(error)
  }
}

export function updateReading(
  db: Executor,
  input: UpdateReadingInput,
  today: string,
) {
  const { id, confirmPreviousChange, ...values } =
    updateReadingSchema.parse(input)
  try {
    return db.transaction((tx) => {
      const existing = tx
        .select()
        .from(readings)
        .where(eq(readings.id, id))
        .get()
      if (!existing) throw new UserFacingError('Leitura não encontrada.')

      // Old rows may already be off the chain (e.g. imported data); only a
      // new value for "leitura anterior" needs confirming.
      if (values.previousReading !== existing.previousReading) {
        const before = latestBefore(
          tx,
          [existing.propertyId],
          { year: values.year, month: values.month },
          id,
        ).get(existing.propertyId)
        assertChained(before, values.previousReading, confirmPreviousChange)
      }

      const reading = tx
        .update(readings)
        .set({
          ...values,
          paidAt: values.paid ? (existing.paidAt ?? today) : null,
        })
        .where(eq(readings.id, id))
        .returning()
        .get()

      const samePeriod =
        existing.year === values.year && existing.month === values.month
      const relinked = samePeriod
        ? relinkNext(
            tx,
            existing.propertyId,
            existing,
            existing.currentReading,
            values.currentReading,
          )
        : null
      return { reading, relinked }
    })
  } catch (error) {
    translateDatabaseError(error)
  }
}

export function deleteReading(db: Executor, id: number) {
  db.delete(readings).where(eq(readings.id, id)).run()
}

export interface HistoryFilters {
  propertyId?: number
  year?: number
  status?: 'pago' | 'pendente'
}

export function listHistory(db: Executor, filters: HistoryFilters) {
  const conditions = [
    filters.propertyId
      ? eq(readings.propertyId, filters.propertyId)
      : undefined,
    filters.year ? eq(readings.year, filters.year) : undefined,
    filters.status ? eq(readings.paid, filters.status === 'pago') : undefined,
  ].filter((condition) => condition !== undefined)

  return db
    .select({
      reading: readings,
      property: { id: properties.id, name: properties.name },
      owner: { id: owners.id, name: owners.name },
    })
    .from(readings)
    .innerJoin(properties, eq(properties.id, readings.propertyId))
    .leftJoin(owners, eq(owners.id, properties.ownerId))
    .where(conditions.length ? and(...conditions) : undefined)
    .all()
    .sort(
      (a, b) =>
        comparePeriods(b.reading, a.reading) ||
        byName.compare(a.property.name, b.property.name),
    )
    .map(({ reading, property, owner }) => ({
      ...withBill(reading),
      property,
      owner,
    }))
}

/** Years that have readings, newest first, always including the current year. */
export function listYears(db: Executor) {
  const years = db
    .selectDistinct({ year: readings.year })
    .from(readings)
    .all()
    .map((row) => row.year)
  return [...new Set([currentPeriod().year, ...years])].sort((a, b) => b - a)
}

/** The most recent month that has readings, if any. */
export function latestReadingPeriod(db: Executor): Period | null {
  const row = db
    .select({ year: readings.year, month: readings.month })
    .from(readings)
    .orderBy(desc(readings.year), desc(readings.month))
    .limit(1)
    .get()
  return row ?? null
}
