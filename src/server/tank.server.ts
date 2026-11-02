import { asc, eq } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import { properties, tankReadings } from '#/db/schema'
import { translateDatabaseError, UserFacingError } from '#/lib/errors'
import { todayISO } from '#/lib/periods'
import { type TankReadingInput, tankReadingSchema } from '#/lib/schemas'
import {
  type ChacaraMeter,
  checkTankReading,
  compareTank,
  monthlyAverages,
  recentPace,
  type Stretch,
  type TankPoint,
} from '#/lib/tank'
import { presentReadings } from './readings.server'

const byName = new Intl.Collator('pt-BR', {
  numeric: true,
  sensitivity: 'base',
})

const pointColumns = {
  id: tankReadings.id,
  date: tankReadings.date,
  liters: tankReadings.readingLiters,
  meterReplaced: tankReadings.meterReplaced,
}

/** The readings of the caixa d'água's meter, oldest first. */
export function listTankReadings(db: Executor): TankPoint[] {
  return db
    .select(pointColumns)
    .from(tankReadings)
    .orderBy(asc(tankReadings.date))
    .all()
}

/** Every chácara with its readings as stretches of its meter, by name. */
export function chacaraMeters(db: Executor): ChacaraMeter[] {
  const stretches = new Map<number, Stretch[]>()
  // Each chácara's readings come oldest first.
  for (const reading of presentReadings(db).values()) {
    const list = stretches.get(reading.propertyId) ?? []
    list.push({
      startDate: reading.startDate,
      endDate: reading.endDate,
      consumption: reading.bill.consumption,
    })
    stretches.set(reading.propertyId, list)
  }
  return db
    .select({
      id: properties.id,
      name: properties.name,
      active: properties.active,
      createdAt: properties.createdAt,
    })
    .from(properties)
    .all()
    .sort((a, b) => byName.compare(a.name, b.name))
    .map((property) => ({
      name: property.name,
      active: property.active,
      registeredOn: todayISO(property.createdAt),
      stretches: stretches.get(property.id) ?? [],
    }))
}

/**
 * Everything the Caixa d'água screen shows: the tank's readings (newest
 * first), each with the water used since the one before and what the
 * chácaras measured in the same days, and the averages a month.
 */
export function getTankPage(db: Executor, today = todayISO()) {
  const points = listTankReadings(db)
  const meters = chacaraMeters(db)
  const rows = compareTank(points, meters)
  return {
    today,
    rows,
    averages: monthlyAverages(points, meters, rows),
    /** m³ a month lately, to question a reading far above it. */
    pace: recentPace(points),
  }
}

export type TankPage = ReturnType<typeof getTankPage>

/**
 * Keeps "Hidrômetro trocado" true to the readings: a reading lower than the
 * one before it can only be a new meter, and one that isn't lower is on the
 * same meter. Needed whenever readings change, move or go away, since their
 * neighbours then follow other readings.
 */
export function syncReplacedMeters(tx: Executor) {
  const points = listTankReadings(tx)
  points.forEach((point, index) => {
    const before = points[index - 1]
    const replaced = before !== undefined && point.liters < before.liters
    if (point.meterReplaced !== replaced) {
      tx.update(tankReadings)
        .set({ meterReplaced: replaced })
        .where(eq(tankReadings.id, point.id))
        .run()
    }
  })
}

/**
 * Saves a reading of the tank's meter, new or corrected. It must fit among
 * the others by date: not lower than the reading before (unless the meter
 * was replaced) nor higher than the one after.
 */
export function saveTankReading(
  db: Executor,
  input: TankReadingInput,
  today = todayISO(),
) {
  const entry = tankReadingSchema.parse(input)
  try {
    return db.transaction((tx) => {
      const points = listTankReadings(tx)
      const current =
        entry.id === undefined
          ? undefined
          : points.find((point) => point.id === entry.id)
      if (entry.id !== undefined && !current) {
        throw new UserFacingError('Leitura da caixa d’água não encontrada.')
      }
      const { problem, meterQuestion } = checkTankReading(points, entry, today)
      if (problem) throw new UserFacingError(problem)

      const values = {
        date: entry.date,
        readingLiters: entry.liters,
        meterReplaced: meterQuestion && entry.meterReplaced === true,
      }
      const saved = current
        ? tx
            .update(tankReadings)
            .set(values)
            .where(eq(tankReadings.id, current.id))
            .returning(pointColumns)
            .get()
        : tx.insert(tankReadings).values(values).returning(pointColumns).get()
      syncReplacedMeters(tx)
      return saved
    })
  } catch (error) {
    translateDatabaseError(error)
  }
}

export function deleteTankReading(db: Executor, id: number) {
  db.transaction((tx) => {
    tx.delete(tankReadings).where(eq(tankReadings.id, id)).run()
    syncReplacedMeters(tx)
  })
}
