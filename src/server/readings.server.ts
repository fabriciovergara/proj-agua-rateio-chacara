import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import {
  owners,
  type Period,
  periods,
  properties,
  type Reading,
  readings,
} from '#/db/schema'
import { billOf, consumptionOf } from '#/lib/billing'
import { translateDatabaseError, UserFacingError } from '#/lib/errors'
import { formatNumber } from '#/lib/money'
import {
  type DateRange,
  formatDate,
  formatDateRange,
  todayISO,
  yearOf,
} from '#/lib/periods'
import {
  type PeriodSheetInput,
  periodSheetSchema,
  type ReadingEntryInput,
  type ReadingInput,
  readingEntrySchema,
  readingSchema,
  type UpdateReadingInput,
  updateReadingSchema,
} from '#/lib/schemas'
import {
  adjacentPeriods,
  getPeriod,
  latestPeriod,
  listPeriods,
  newPeriodDefaults,
  periodCounts,
  periodYears,
  repricePeriod,
  savePeriodValues,
} from './periods.server'

const byName = new Intl.Collator('pt-BR', {
  numeric: true,
  sensitivity: 'base',
})

const ownerSummary = { id: owners.id, name: owners.name, phone: owners.phone }

const periodColumns = {
  id: periods.id,
  startDate: periods.startDate,
  endDate: periods.endDate,
  energyBillCents: periods.energyBillCents,
}

type PeriodSummary = Pick<
  Period,
  'id' | 'startDate' | 'endDate' | 'energyBillCents'
>
type Placed = { reading: Reading; period: PeriodSummary }

/**
 * A reading as the screens show it: its bill and its own dates. A reading
 * ends on its own date or the period's end, and starts when the chácara's
 * reading before it ended (the first one: its own date or the period's
 * start).
 */
function present({ reading, period }: Placed, before: Placed | undefined) {
  const { startDate: _start, endDate: _end, ...values } = reading
  return {
    ...values,
    startDate: before ? endOf(before) : (reading.startDate ?? period.startDate),
    endDate: endOf({ reading, period }),
    period,
    bill: billOf(reading),
  }
}

export type ReadingView = ReturnType<typeof present>

const endOf = ({ reading, period }: Placed) => reading.endDate ?? period.endDate

/** The readings of each chácara, oldest first. */
function timelines(db: Executor, propertyIds?: number[]) {
  const rows = db
    .select({ reading: readings, period: periodColumns })
    .from(readings)
    .innerJoin(periods, eq(periods.id, readings.periodId))
    .where(propertyIds ? inArray(readings.propertyId, propertyIds) : undefined)
    .orderBy(asc(readings.propertyId), asc(periods.startDate))
    .all()
  const byProperty = new Map<number, Placed[]>()
  for (const row of rows) {
    const list = byProperty.get(row.reading.propertyId) ?? []
    list.push(row)
    byProperty.set(row.reading.propertyId, list)
  }
  return byProperty
}

/** Every reading of the given chácaras (all when omitted) with its dates. */
export function presentReadings(db: Executor, propertyIds?: number[]) {
  const result = new Map<number, ReadingView>()
  for (const list of timelines(db, propertyIds).values()) {
    list.forEach((placed, index) => {
      result.set(placed.reading.id, present(placed, list[index - 1]))
    })
  }
  return result
}

/** Where `period` falls in a chácara's readings. */
function locate(list: Placed[], period: DateRange) {
  const found = list.findIndex(
    ({ period: other }) => other.startDate >= period.startDate,
  )
  const at = found === -1 ? list.length : found
  const existing =
    list[at]?.period.startDate === period.startDate ? list[at] : undefined
  return {
    existing,
    before: list[at - 1],
    after: list[existing ? at + 1 : at],
    /** The reading before `before`, to know when `before` started. */
    beforeBefore: list[at - 2],
    /** The readings before the period. */
    earlier: list.slice(0, at),
  }
}

/** Average consumption of the last readings, to spot typos. */
function recentAverage(list: Placed[]): number | null {
  const recent = list.slice(-6)
  if (recent.length === 0) return null
  const total = recent.reduce(
    (sum, { reading }) => sum + consumptionOf(reading),
    0,
  )
  return Math.round(total / recent.length)
}

/** A date stored only when it differs from the period's. */
const ownDate = (date: string, periodDate: string) =>
  date === periodDate ? null : date

/** Another reading that a save also changed, for the confirmation. */
export interface Relinked {
  property: string
  startDate: string
  endDate: string
}

/**
 * Saves one chácara's reading in a period (new or corrected) and keeps the
 * chain between its readings:
 *  - "Última leitura" is the previous reading's "Leitura atual": changing it
 *    corrects the previous reading too, unless the meter was replaced;
 *  - the reading after it starts where this one ends, in m³ and in date.
 * Returns the periods it changed, which the caller reprices.
 */
function saveEntry(tx: Executor, period: Period, input: ReadingEntryInput) {
  const entry = readingEntrySchema.parse(input)
  const property = tx
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .where(eq(properties.id, entry.propertyId))
    .get()
  if (!property) throw new UserFacingError('Chácara não encontrada.')
  const name = property.name

  const list = timelines(tx, [property.id]).get(property.id) ?? []
  const { existing, before, after, beforeBefore } = locate(list, period)
  const touched = new Set<number>([period.id])
  /** Other readings of the chácara this save corrected. */
  const corrected = new Set<number>()

  // "Última leitura" corrects the reading before, if they were linked.
  const linked = existing
    ? before?.reading.currentReading === existing.reading.previousReading
    : true
  if (
    before &&
    linked &&
    !entry.meterReplaced &&
    entry.previousReading !== before.reading.currentReading
  ) {
    if (entry.previousReading < before.reading.previousReading) {
      throw new UserFacingError(
        `${name}: a última leitura (${formatNumber(entry.previousReading)}) é menor que a leitura anterior a ela (${formatNumber(before.reading.previousReading)}). Confira o número; se o hidrômetro foi trocado, confirme a troca.`,
      )
    }
    tx.update(readings)
      .set({ currentReading: entry.previousReading })
      .where(eq(readings.id, before.reading.id))
      .run()
    touched.add(before.period.id)
    corrected.add(before.reading.id)
  }

  // The date of the última leitura is when the reading before ended.
  if (before && entry.startDate !== endOf(before)) {
    const beforeStart = present(before, beforeBefore).startDate
    if (entry.startDate <= beforeStart) {
      throw new UserFacingError(
        `${name}: a data da última leitura (${formatDate(entry.startDate)}) ficaria antes da leitura anterior a ela (${formatDate(beforeStart)}).`,
      )
    }
    tx.update(readings)
      .set({ endDate: ownDate(entry.startDate, before.period.endDate) })
      .where(eq(readings.id, before.reading.id))
      .run()
    corrected.add(before.reading.id)
  }
  if (after && entry.endDate >= endOf(after)) {
    throw new UserFacingError(
      `${name}: a data da leitura (${formatDate(entry.endDate)}) ficaria depois da leitura seguinte (${formatDate(endOf(after))}).`,
    )
  }

  const values = {
    previousReading: entry.previousReading,
    currentReading: entry.currentReading,
    // Only the first reading keeps its start; later ones follow the one before.
    startDate: before ? null : ownDate(entry.startDate, period.startDate),
    endDate: ownDate(entry.endDate, period.endDate),
  }
  const reading = existing
    ? tx
        .update(readings)
        .set(values)
        .where(eq(readings.id, existing.reading.id))
        .returning()
        .get()
    : tx
        .insert(readings)
        .values({
          ...values,
          propertyId: property.id,
          periodId: period.id,
          energyCents: null,
          reserveFundCents: period.reserveFundCents,
        })
        .returning()
        .get()

  // The reading after follows "Leitura atual", if they were linked. A new
  // reading before the chácara's first one becomes the one it follows.
  const linkedTo = existing
    ? existing.reading.currentReading
    : before
      ? before.reading.currentReading
      : after?.reading.previousReading
  if (
    after &&
    after.reading.previousReading === linkedTo &&
    linkedTo !== entry.currentReading
  ) {
    if (after.reading.currentReading < entry.currentReading) {
      throw new UserFacingError(
        `${name}: a leitura de ${formatDateRange(present(after, existing ?? before))} (${formatNumber(after.reading.currentReading)}) ficaria menor que ${formatNumber(entry.currentReading)}. Corrija aquela leitura primeiro.`,
      )
    }
    tx.update(readings)
      .set({ previousReading: entry.currentReading })
      .where(eq(readings.id, after.reading.id))
      .run()
    touched.add(after.period.id)
    corrected.add(after.reading.id)
  }

  // Describe the corrected readings as they are now.
  const relinked: Relinked[] = []
  if (corrected.size > 0) {
    const now = timelines(tx, [property.id]).get(property.id) ?? []
    now.forEach((placed, index) => {
      if (!corrected.has(placed.reading.id)) return
      const { startDate, endDate } = present(placed, now[index - 1])
      relinked.push({ property: name, startDate, endDate })
    })
  }

  const changed =
    !existing ||
    corrected.size > 0 ||
    existing.reading.previousReading !== values.previousReading ||
    existing.reading.currentReading !== values.currentReading ||
    existing.reading.startDate !== values.startDate ||
    existing.reading.endDate !== values.endDate
  return { reading, touched, relinked, changed }
}

function repriceAll(tx: Executor, periodIds: Iterable<number>) {
  for (const id of periodIds) repricePeriod(tx, id)
}

/** Everything the Leituras screen needs for one period. */
export function getPeriodSheet(
  db: Executor,
  periodId: number | undefined,
  today = todayISO(),
) {
  const all = listPeriods(db)
  const period =
    (periodId === undefined ? null : getPeriod(db, periodId)) ??
    latestPeriod(db)
  const newPeriod = newPeriodDefaults(db, today)
  /** Active chácaras: without any, there is nothing to read. */
  const chacaras = db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.active, true))
    .all().length
  if (!period) {
    return { periods: all, period: null, newPeriod, chacaras, rows: [] }
  }

  const inPeriod = new Set(
    db
      .select({ propertyId: readings.propertyId })
      .from(readings)
      .where(eq(readings.periodId, period.id))
      .all()
      .map((row) => row.propertyId),
  )
  const visible = db
    .select({ property: properties, owner: ownerSummary })
    .from(properties)
    .leftJoin(owners, eq(owners.id, properties.ownerId))
    .all()
    // Inactive chácaras only appear in periods where they were read.
    .filter(({ property }) => property.active || inPeriod.has(property.id))
    .sort((a, b) => byName.compare(a.property.name, b.property.name))
  const histories = timelines(
    db,
    visible.map(({ property }) => property.id),
  )

  const rows = visible.map(({ property, owner }) => {
    const list = histories.get(property.id) ?? []
    const { existing, before, beforeBefore, earlier } = locate(list, period)
    return {
      property: {
        id: property.id,
        name: property.name,
        meterNumber: property.meterNumber,
        active: property.active,
      },
      owner,
      reading: existing ? present(existing, before) : null,
      /** The chácara's reading before this period: "Última leitura". */
      previous: before
        ? {
            ...present(before, beforeBefore),
            /**
             * It ends with its period, right where this one starts: moving
             * this period's start moves it too.
             */
            endsAtPeriodStart:
              before.reading.endDate === null &&
              before.period.endDate === period.startDate,
          }
        : null,
      averageConsumption: recentAverage(earlier),
    }
  })

  const { previous, next } = adjacentPeriods(db, period)
  return {
    periods: all,
    period: {
      ...period,
      previousId: previous?.id ?? null,
      nextId: next?.id ?? null,
      counts: periodCounts(db, period.id),
    },
    newPeriod,
    chacaras,
    rows,
  }
}

export type PeriodSheet = ReturnType<typeof getPeriodSheet>

/**
 * Saves the Leituras screen: the period's dates and values and the readings
 * typed in it (new or corrected), then splits the bill again.
 */
export function savePeriodSheet(db: Executor, input: PeriodSheetInput) {
  const { periodId, period: values, entries } = periodSheetSchema.parse(input)
  try {
    return db.transaction((tx) => {
      const period = savePeriodValues(tx, periodId, values)
      const touched = new Set<number>([period.id])
      const relinked: Relinked[] = []
      let saved = 0
      for (const entry of entries) {
        const result = saveEntry(tx, period, entry)
        for (const id of result.touched) touched.add(id)
        relinked.push(...result.relinked)
        if (result.changed) saved++
      }
      repriceAll(tx, touched)
      return { saved, relinked }
    })
  } catch (error) {
    translateDatabaseError(error)
  }
}

export function setPaid(
  db: Executor,
  input: { id: number; paid: boolean },
  today: string,
) {
  return db.transaction((tx) => {
    const reading = tx
      .select()
      .from(readings)
      .where(eq(readings.id, input.id))
      .get()
    if (!reading) throw new UserFacingError('Leitura não encontrada.')
    if (input.paid && reading.energyCents === null) {
      throw new UserFacingError(
        'Informe antes o valor da conta de energia deste período.',
      )
    }
    const updated = tx
      .update(readings)
      .set({
        paid: input.paid,
        paidAt: input.paid ? (reading.paidAt ?? today) : null,
      })
      .where(eq(readings.id, input.id))
      .returning()
      .get()
    // No longer paid: it follows the period's split again.
    if (!input.paid) repricePeriod(tx, reading.periodId)
    return updated
  })
}

/** Marks a reading paid or not after it was saved and repriced. */
function applyPaid(
  tx: Executor,
  reading: Reading,
  paid: boolean,
  today: string,
) {
  if (reading.paid === paid) return
  setPaid(tx, { id: reading.id, paid }, today)
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

  const list = timelines(db, [propertyId]).get(propertyId) ?? []
  return {
    property: row.property,
    owner: row.owner,
    readings: list.map((placed, index) => present(placed, list[index - 1])),
    /** Periods, newest first: "Nova leitura" offers those without one. */
    periods: listPeriods(db),
  }
}

export function createReading(
  db: Executor,
  input: ReadingInput,
  today: string,
) {
  const { periodId, paid, ...entry } = readingSchema.parse(input)
  try {
    return db.transaction((tx) => {
      const period = getPeriod(tx, periodId)
      if (!period) throw new UserFacingError('Período não encontrado.')
      const taken = tx
        .select({ id: readings.id })
        .from(readings)
        .where(
          and(
            eq(readings.propertyId, entry.propertyId),
            eq(readings.periodId, periodId),
          ),
        )
        .get()
      if (taken) {
        throw new UserFacingError(
          'Esta chácara já tem leitura neste período. Corrija a linha dela na tabela.',
        )
      }
      const result = saveEntry(tx, period, entry)
      repriceAll(tx, result.touched)
      const saved = tx
        .select()
        .from(readings)
        .where(eq(readings.id, result.reading.id))
        .get()
      if (saved) applyPaid(tx, saved, paid, today)
      return { reading: result.reading, relinked: result.relinked }
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
  const { id, paid, ...values } = updateReadingSchema.parse(input)
  try {
    return db.transaction((tx) => {
      const existing = tx
        .select()
        .from(readings)
        .where(eq(readings.id, id))
        .get()
      if (!existing) throw new UserFacingError('Leitura não encontrada.')
      const period = getPeriod(tx, existing.periodId)
      if (!period) throw new UserFacingError('Período não encontrado.')

      const result = saveEntry(tx, period, {
        ...values,
        propertyId: existing.propertyId,
      })
      repriceAll(tx, result.touched)
      const saved = tx.select().from(readings).where(eq(readings.id, id)).get()
      if (saved) applyPaid(tx, saved, paid, today)
      return { reading: result.reading, relinked: result.relinked }
    })
  } catch (error) {
    translateDatabaseError(error)
  }
}

/** Deletes a reading; the other bills of its period are split again. */
export function deleteReading(db: Executor, id: number) {
  db.transaction((tx) => {
    const reading = tx
      .delete(readings)
      .where(eq(readings.id, id))
      .returning({ periodId: readings.periodId })
      .get()
    if (reading) repricePeriod(tx, reading.periodId)
  })
}

export interface HistoryFilters {
  propertyId?: number
  /** Periods that end in this year. */
  year?: number
  status?: 'pago' | 'pendente'
}

export function listHistory(db: Executor, filters: HistoryFilters) {
  const views = presentReadings(
    db,
    filters.propertyId ? [filters.propertyId] : undefined,
  )
  const people = new Map(
    db
      .select({
        property: { id: properties.id, name: properties.name },
        owner: { id: owners.id, name: owners.name },
      })
      .from(properties)
      .leftJoin(owners, eq(owners.id, properties.ownerId))
      .all()
      .map((row) => [row.property.id, row]),
  )

  return [...views.values()]
    .filter(
      (reading) =>
        (!filters.year || yearOf(reading.period.endDate) === filters.year) &&
        (!filters.status || reading.paid === (filters.status === 'pago')),
    )
    .flatMap((reading) => {
      const who = people.get(reading.propertyId)
      return who
        ? [{ ...reading, property: who.property, owner: who.owner }]
        : []
    })
    .sort(
      (a, b) =>
        b.period.startDate.localeCompare(a.period.startDate) ||
        byName.compare(a.property.name, b.property.name),
    )
}

/** Years with periods, newest first, always including the current year. */
export function listYears(db: Executor, today = todayISO()) {
  return [...new Set([yearOf(today), ...periodYears(db)])].sort((a, b) => b - a)
}
