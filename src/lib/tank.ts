/*
 * The caixa d'água: the tank that supplies every chácara has its own water
 * meter. All the water the chácaras' meters measure passed through it, so
 * over the same days both measure about the same. The tank measuring
 * clearly more points to water lost on the way (a leak); the chácaras
 * measuring more, to a reading typed wrong.
 *
 * Each stretch between two readings of the tank is compared with what the
 * chácaras' meters measured in the same days. Their readings rarely fall on
 * the same days as the tank's, so a reading partly inside a stretch counts
 * by its days, as if the water had been used evenly (an estimate).
 */
import { isUnusualConsumption } from './billing'
import {
  addMonthsToDate,
  type DateRange,
  daysBetween,
  formatDate,
} from './periods'

/** An average month (365,25 ÷ 12 days), for "por mês". */
export const DAYS_PER_MONTH = 365.25 / 12

/**
 * Up to 10% of difference is normal: meters are not exact (more so with
 * small flows), the chácaras' show whole m³, and they are not all read at
 * the same moment.
 */
export const TOLERANCE = 0.1
/** …and so are up to 10 m³, whatever the share. */
export const TOLERANCE_M3 = 10

/**
 * Chácaras read up to a week before a stretch ends count as if they had
 * kept the pace of their last reading until then (an estimate), so the
 * tank's newest reading is compared without waiting for the next round.
 */
export const EXTEND_DAYS = 7

/** The largest reading accepted: 999.999.999,999 m³. */
export const MAX_TANK_LITERS = 999_999_999_999

/** From one reading of a meter to the next, and the m³ it measured. */
export interface Stretch extends DateRange {
  /** Null: unknown, the meter was replaced in between. */
  consumption: number | null
}

/** A reading of the tank's meter. */
export interface TankPoint {
  id: number
  date: string
  /** What the meter shows, in liters (m³ × 1000). */
  liters: number
  /** A new meter since the reading before: the count starts again. */
  meterReplaced: boolean
}

const m3Format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })

/** 1254370 liters → "1.254,37" (m³, as on the meter). */
export function formatTankReading(liters: number): string {
  return m3Format.format(liters / 1000)
}

/**
 * A tank reading as typed, in m³ with up to 3 decimals ("1254,37",
 * "1.254,37" or "1254.37") → liters, or null.
 */
export function parseTankReading(text: string): number | null {
  let value = text.replace(/\s|m³|m3/gi, '')
  if (value.includes(',')) value = value.replace(/\./g, '').replace(',', '.')
  // "1254," while typing is 1254.
  const match = /^(\d+)(?:\.(\d{0,3}))?$/.exec(value)
  if (!match) return null
  const liters =
    Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'))
  return Number.isSafeInteger(liters) && liters <= MAX_TANK_LITERS
    ? liters
    : null
}

const later = (a: string, b: string) => (a > b ? a : b)
const earlier = (a: string, b: string) => (a < b ? a : b)

/** m³ a month, from the m³ used in some days. */
export function perMonth(consumption: number, days: number): number | null {
  return days > 0 ? (consumption / days) * DAYS_PER_MONTH : null
}

/** The tank's readings (oldest first) as the stretches between them. */
export function tankStretches(points: readonly TankPoint[]): Stretch[] {
  return points.slice(1).map((point, index) => {
    const before = points[index] as TankPoint
    return {
      startDate: before.date,
      endDate: point.date,
      consumption:
        point.meterReplaced || point.liters < before.liters
          ? null
          : (point.liters - before.liters) / 1000,
    }
  })
}

/**
 * The m³ a meter's stretches (oldest first, each starting where the one
 * before ended) measured within a window. A stretch partly inside counts
 * by its days. `days`: the days of the window with a known consumption.
 */
export function usageWithin(stretches: readonly Stretch[], window: DateRange) {
  let consumption = 0
  let days = 0
  let prorated = false
  let unknown = false
  for (const stretch of stretches) {
    const start = later(stretch.startDate, window.startDate)
    const end = earlier(stretch.endDate, window.endDate)
    if (start >= end) continue
    if (stretch.consumption === null) {
      unknown = true
      continue
    }
    const length = daysBetween(stretch.startDate, stretch.endDate)
    if (length <= 0) continue
    const inside = daysBetween(start, end)
    consumption += (stretch.consumption * inside) / length
    days += inside
    if (inside < length) prorated = true
  }
  return { consumption, days, prorated, unknown }
}

export type Measured =
  | { status: 'ok'; consumption: number; estimated: boolean }
  /** A meter was replaced within the window. */
  | { status: 'unknown' }
  /** The readings stop before the window ends. */
  | { status: 'short' }

/**
 * What a meter measured within a window, when its readings reach the
 * window's end. Readings that stop a few days short (EXTEND_DAYS) are
 * extended at the pace of the last one, as an estimate.
 */
export function measuredIn(
  stretches: readonly Stretch[],
  window: DateRange,
): Measured {
  const last = stretches.at(-1)
  let all = stretches
  let extended = false
  if (!last || last.endDate < window.endDate) {
    const gap = last ? daysBetween(last.endDate, window.endDate) : 0
    const length = last ? daysBetween(last.startDate, last.endDate) : 0
    if (!last || last.consumption === null || gap > EXTEND_DAYS || !length) {
      return { status: 'short' }
    }
    all = [
      ...stretches,
      {
        startDate: last.endDate,
        endDate: window.endDate,
        consumption: (last.consumption * gap) / length,
      },
    ]
    extended = true
  }
  const usage = usageWithin(all, window)
  if (usage.unknown) return { status: 'unknown' }
  return {
    status: 'ok',
    consumption: usage.consumption,
    estimated: extended || usage.prorated,
  }
}

export type Verdict = 'normal' | 'vazamento' | 'conferir'

/**
 * The tank against the chácaras, in whole m³: "vazamento" when the tank
 * measured more than the tolerance above the chácaras, "conferir" when the
 * chácaras measured that much more than the tank.
 */
export function verdictOf(tank: number, chacaras: number) {
  const difference = tank - chacaras
  const margin = Math.max(tank * TOLERANCE, TOLERANCE_M3)
  const verdict: Verdict =
    difference > margin
      ? 'vazamento'
      : -difference > margin
        ? 'conferir'
        : 'normal'
  return {
    /** Tank − chácaras (m³): positive is water lost on the way. */
    difference,
    /** Of the tank's m³; null when the tank measured nothing. */
    share: tank > 0 ? difference / tank : null,
    verdict,
  }
}

/** A chácara's meter, for the comparison. */
export interface ChacaraMeter {
  name: string
  active: boolean
  /** When it was registered: expected in the stretches that end later. */
  registeredOn: string
  /** Its readings, oldest first, each starting where the one before ended. */
  stretches: Stretch[]
}

/**
 * What the chácaras measured within a window. Known when the readings of
 * every active chácara reach the window's end (one first read later counts
 * from then; an inactive one, up to its last reading); `missing` names the
 * others. Before the first reading of any chácara there is nothing to
 * compare (`uncovered`).
 */
export function chacarasWithin(
  chacaras: readonly ChacaraMeter[],
  window: DateRange,
) {
  const firstDates = chacaras.flatMap((c) => c.stretches[0]?.startDate ?? [])
  const since = firstDates.sort()[0]
  if (since === undefined || window.startDate < since) {
    return { measured: null, missing: [], uncovered: true }
  }
  let total = 0
  let estimated = false
  const missing: string[] = []
  for (const chacara of chacaras) {
    const first = chacara.stretches[0]
    if (!first) {
      if (chacara.active && chacara.registeredOn < window.endDate) {
        missing.push(chacara.name)
      }
      continue
    }
    // Not read yet back then.
    if (first.startDate >= window.endDate) continue
    if (!chacara.active) {
      const usage = usageWithin(chacara.stretches, window)
      total += usage.consumption
      estimated ||= usage.prorated
      continue
    }
    const own = measuredIn(chacara.stretches, window)
    if (own.status !== 'ok') {
      missing.push(chacara.name)
      continue
    }
    total += own.consumption
    estimated ||= own.estimated
  }
  return {
    measured:
      missing.length === 0
        ? { consumption: Math.round(total), estimated }
        : null,
    missing,
    uncovered: false,
  }
}

/**
 * Each reading of the tank (newest first) with the water used since the one
 * before, its pace a month and what the chácaras measured in the same days.
 */
export function compareTank(
  points: readonly TankPoint[],
  chacaras: readonly ChacaraMeter[],
) {
  const stretches = tankStretches(points)
  return points
    .map((point, index) => {
      const stretch = index > 0 ? stretches[index - 1] : undefined
      if (!stretch) return { ...point, since: null }
      const days = daysBetween(stretch.startDate, stretch.endDate)
      const raw = stretch.consumption
      const consumption = raw === null ? null : Math.round(raw)
      const chacarasSide =
        consumption === null ? null : chacarasWithin(chacaras, stretch)
      const monthly = raw === null ? null : perMonth(raw, days)
      return {
        ...point,
        since: {
          startDate: stretch.startDate,
          days,
          /** m³ since the reading before; null with a new meter. */
          consumption,
          perMonth: monthly === null ? null : Math.round(monthly),
          chacaras: chacarasSide?.measured ?? null,
          missing: chacarasSide?.missing ?? [],
          /** No chácara was read back then. */
          uncovered: chacarasSide?.uncovered ?? false,
          result:
            consumption !== null && chacarasSide?.measured
              ? verdictOf(consumption, chacarasSide.measured.consumption)
              : null,
        },
      }
    })
    .reverse()
}

export type TankRow = ReturnType<typeof compareTank>[number]

/**
 * The tank's average m³ a month over 12 months of readings (or since the
 * first one), leaving out stretches with a meter replaced, and the
 * chácaras' in the same days. The 12 months end at the newest reading that
 * could be compared with the chácaras, so the averages are of the same
 * days; without any, at the newest reading (the tank's average only).
 */
export function monthlyAverages(
  points: readonly TankPoint[],
  chacaras: readonly ChacaraMeter[],
  rows: readonly TankRow[] = compareTank(points, chacaras),
) {
  const compared = rows.find((row) => row.since?.result)
  const endDate = compared?.date ?? points.at(-1)?.date
  const stretches = tankStretches(points).filter(
    (stretch) => endDate !== undefined && stretch.endDate <= endDate,
  )
  const first = stretches[0]
  if (!first || endDate === undefined) return null
  const yearAgo = addMonthsToDate(endDate, -12)
  const window = { startDate: later(first.startDate, yearAgo), endDate }
  const usage = usageWithin(stretches, window)
  const tank = perMonth(usage.consumption, usage.days)
  if (tank === null) return null
  // With a meter replaced, the days of the two sides would differ.
  const others = usage.unknown ? null : chacarasWithin(chacaras, window)
  const chacarasMonthly = others?.measured
    ? perMonth(others.measured.consumption, usage.days)
    : null
  const tankPerMonth = Math.round(tank)
  const chacarasPerMonth =
    chacarasMonthly === null ? null : Math.round(chacarasMonthly)
  return {
    ...window,
    /** A whole year of readings. */
    fullYear: window.startDate === yearAgo,
    tankPerMonth,
    chacarasPerMonth,
    missing: others?.missing ?? [],
    uncovered: others?.uncovered ?? false,
    result:
      chacarasPerMonth === null
        ? null
        : verdictOf(tankPerMonth, chacarasPerMonth),
  }
}

/** The tank's pace over its last readings (m³ a month), to spot typos. */
export function recentPace(points: readonly TankPoint[]): number | null {
  const known = tankStretches(points)
    .filter((stretch) => stretch.consumption !== null)
    .slice(-6)
  let consumption = 0
  let days = 0
  for (const stretch of known) {
    consumption += stretch.consumption ?? 0
    days += daysBetween(stretch.startDate, stretch.endDate)
  }
  const pace = perMonth(consumption, days)
  return pace === null ? null : Math.round(pace)
}

/** Far above the tank's recent pace: probably a typo (or a big leak). */
export function isUnusualPace(
  consumption: number,
  days: number,
  pace: number | null,
): boolean {
  const monthly = perMonth(consumption, days)
  return monthly !== null && isUnusualConsumption(monthly, pace)
}

/** A tank reading being typed: new (no id) or a correction. */
export interface TankEntry {
  id?: number
  date: string
  liters: number
  meterReplaced?: boolean
}

/** What can be wrong with a reading of the tank. */
export type TankIssue = 'future' | 'same-date' | 'lower' | 'higher'

/**
 * Where a tank reading falls among the others (oldest first) and what is
 * wrong with it, if anything: a date after today, another reading on the
 * same day, lower than the reading before (only a new meter explains it:
 * `meterQuestion`) or higher than the one after.
 */
export function checkTankReading(
  points: readonly TankPoint[],
  entry: TankEntry,
  today: string,
) {
  const others = points.filter((point) => point.id !== entry.id)
  const before = others.filter((point) => point.date < entry.date).at(-1)
  const after = others.find((point) => point.date > entry.date)
  const meterQuestion = before !== undefined && entry.liters < before.liters
  const issue: TankIssue | null =
    entry.date > today
      ? 'future'
      : others.some((point) => point.date === entry.date)
        ? 'same-date'
        : meterQuestion && !entry.meterReplaced
          ? 'lower'
          : after && !after.meterReplaced && after.liters < entry.liters
            ? 'higher'
            : null

  const typed = formatTankReading(entry.liters)
  const problem =
    issue === 'future'
      ? `A data da leitura (${formatDate(entry.date)}) é depois de hoje. Confira a data.`
      : issue === 'same-date'
        ? `Já existe uma leitura da caixa d’água em ${formatDate(entry.date)}. Corrija a linha dela na tabela.`
        : issue === 'lower' && before
          ? `A leitura (${typed}) é menor que a de ${formatDate(before.date)} (${formatTankReading(before.liters)}). Confira o número; se o hidrômetro foi trocado, marque “Hidrômetro trocado”.`
          : issue === 'higher' && after
            ? `A leitura (${typed}) é maior que a de ${formatDate(after.date)} (${formatTankReading(after.liters)}), que é depois. Confira o número e a data.`
            : null
  return { before, after, meterQuestion, issue, problem }
}
