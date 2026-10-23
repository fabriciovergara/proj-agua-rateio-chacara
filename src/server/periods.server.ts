import { and, asc, desc, eq, gt, lt, ne, sql } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import { type Period, periods, readings } from '#/db/schema'
import { consumptionOf, splitEnergyBill } from '#/lib/billing'
import { UserFacingError } from '#/lib/errors'
import {
  addMonthsToDate,
  type DateRange,
  formatDate,
  formatDateRange,
} from '#/lib/periods'
import {
  type NewPeriodInput,
  newPeriodSchema,
  type PeriodValuesInput,
  periodValuesSchema,
} from '#/lib/schemas'

const rangeColumns = {
  id: periods.id,
  startDate: periods.startDate,
  endDate: periods.endDate,
}

/** Every period, newest first, for the pickers. */
export function listPeriods(db: Executor) {
  return db
    .select({ ...rangeColumns, energyBillCents: periods.energyBillCents })
    .from(periods)
    .orderBy(desc(periods.startDate))
    .all()
}

export function getPeriod(db: Executor, id: number): Period | null {
  return db.select().from(periods).where(eq(periods.id, id)).get() ?? null
}

/** The newest period: Leituras and the reports open on it. */
export function latestPeriod(db: Executor): Period | null {
  return (
    db.select().from(periods).orderBy(desc(periods.startDate)).limit(1).get() ??
    null
  )
}

/** The period that starts before `startDate`, if any. */
function periodBefore(db: Executor, startDate: string): Period | null {
  return (
    db
      .select()
      .from(periods)
      .where(lt(periods.startDate, startDate))
      .orderBy(desc(periods.startDate))
      .limit(1)
      .get() ?? null
  )
}

/** The periods right before and after `period`. */
export function adjacentPeriods(db: Executor, period: DateRange) {
  return {
    previous: periodBefore(db, period.startDate),
    next:
      db
        .select()
        .from(periods)
        .where(gt(periods.startDate, period.startDate))
        .orderBy(asc(periods.startDate))
        .limit(1)
        .get() ?? null,
  }
}

/** A new period starts when the newest one ended and lasts a month. */
export function newPeriodDefaults(db: Executor, today: string): DateRange {
  const startDate = latestPeriod(db)?.endDate ?? addMonthsToDate(today, -1)
  return { startDate, endDate: addMonthsToDate(startDate, 1) }
}

/** Refuses dates that share days with another period. */
function assertFree(db: Executor, range: DateRange, exceptId?: number) {
  const clash = db
    .select(rangeColumns)
    .from(periods)
    .where(
      and(
        lt(periods.startDate, range.endDate),
        gt(periods.endDate, range.startDate),
        exceptId === undefined ? undefined : ne(periods.id, exceptId),
      ),
    )
    .orderBy(asc(periods.startDate))
    .limit(1)
    .get()
  if (clash) {
    throw new UserFacingError(
      `Essas datas se sobrepõem ao período de ${formatDateRange(clash)}. Um período pode começar no dia em que o outro termina.`,
    )
  }
}

/**
 * Creates an empty period. The electricity bill comes later; the reserve
 * fund, which rarely changes, is the one of the period before it (or after
 * it, for a period older than all the others).
 */
export function createPeriod(db: Executor, input: NewPeriodInput) {
  const range = newPeriodSchema.parse(input)
  return db.transaction((tx) => {
    assertFree(tx, range)
    const { previous, next } = adjacentPeriods(tx, range)
    return tx
      .insert(periods)
      .values({
        ...range,
        energyBillCents: null,
        reserveFundCents: (previous ?? next)?.reserveFundCents ?? 0,
      })
      .returning()
      .get()
  })
}

/**
 * Readings that had their own date equal to the period's now just follow
 * the period (stored as null).
 */
function followPeriodDates(db: Executor, period: Period) {
  db.update(readings)
    .set({ startDate: null })
    .where(
      and(
        eq(readings.periodId, period.id),
        eq(readings.startDate, period.startDate),
      ),
    )
    .run()
  db.update(readings)
    .set({ endDate: null })
    .where(
      and(
        eq(readings.periodId, period.id),
        eq(readings.endDate, period.endDate),
      ),
    )
    .run()
}

/**
 * Saves a period's dates and values. A neighbour that touches it (one ends
 * on the day the other starts) moves along, so back-to-back periods stay
 * that way; any other overlap is refused. Callers reprice the period.
 */
export function savePeriodValues(
  db: Executor,
  id: number,
  input: PeriodValuesInput,
): Period {
  const values = periodValuesSchema.parse(input)
  const current = getPeriod(db, id)
  if (!current) throw new UserFacingError('Período não encontrado.')
  const { previous, next } = adjacentPeriods(db, current)

  if (
    previous &&
    previous.endDate === current.startDate &&
    values.startDate !== current.startDate
  ) {
    if (values.startDate <= previous.startDate) {
      throw new UserFacingError(
        `O período começaria antes do período anterior (${formatDateRange(previous)}). Escolha uma data depois de ${formatDate(previous.startDate)}.`,
      )
    }
    const moved = db
      .update(periods)
      .set({ endDate: values.startDate })
      .where(eq(periods.id, previous.id))
      .returning()
      .get()
    followPeriodDates(db, moved)
  }
  if (
    next &&
    next.startDate === current.endDate &&
    values.endDate !== current.endDate
  ) {
    if (values.endDate >= next.endDate) {
      throw new UserFacingError(
        `O período terminaria depois do período seguinte (${formatDateRange(next)}). Escolha uma data antes de ${formatDate(next.endDate)}.`,
      )
    }
    const moved = db
      .update(periods)
      .set({ startDate: values.endDate })
      .where(eq(periods.id, next.id))
      .returning()
      .get()
    followPeriodDates(db, moved)
  }
  assertFree(db, values, id)

  const saved = db
    .update(periods)
    .set(values)
    .where(eq(periods.id, id))
    .returning()
    .get()
  followPeriodDates(db, saved)
  return saved
}

/**
 * Splits the period's electricity bill again among its readings, by the m³
 * each one used, and charges its reserve fund. Paid bills keep what was
 * charged (their m³ still count in the split). Returns how many unpaid
 * bills changed.
 */
export function repricePeriod(db: Executor, periodId: number): number {
  const period = getPeriod(db, periodId)
  if (!period) return 0
  const rows = db
    .select()
    .from(readings)
    .where(eq(readings.periodId, periodId))
    .all()
  const shares =
    period.energyBillCents === null
      ? null
      : splitEnergyBill(
          period.energyBillCents,
          rows.map((row) => ({
            key: row.propertyId,
            consumption: consumptionOf(row),
          })),
        )

  let changed = 0
  for (const row of rows) {
    if (row.paid) continue
    const energyCents = shares?.get(row.propertyId) ?? null
    if (
      row.energyCents === energyCents &&
      row.reserveFundCents === period.reserveFundCents
    ) {
      continue
    }
    db.update(readings)
      .set({ energyCents, reserveFundCents: period.reserveFundCents })
      .where(eq(readings.id, row.id))
      .run()
    changed++
  }
  return changed
}

/** How many readings (and paid ones) a period has, before deleting it. */
export function periodCounts(db: Executor, periodId: number) {
  const row = db
    .select({
      readings: sql<number>`count(*)`,
      paid: sql<number>`coalesce(sum(${readings.paid}), 0)`,
    })
    .from(readings)
    .where(eq(readings.periodId, periodId))
    .get()
  return { readings: row?.readings ?? 0, paid: row?.paid ?? 0 }
}

/** Deletes a period with its readings. */
export function deletePeriod(db: Executor, id: number) {
  db.delete(periods).where(eq(periods.id, id)).run()
}

/** Years with periods (by the year they end), newest first. */
export function periodYears(db: Executor): number[] {
  return db
    .selectDistinct({
      year: sql<number>`cast(substr(${periods.endDate}, 1, 4) as integer)`,
    })
    .from(periods)
    .all()
    .map((row) => row.year)
    .sort((a, b) => b - a)
}
