import { describe, expect, test } from 'bun:test'
import {
  type ChacaraMeter,
  chacarasWithin,
  checkTankReading,
  compareTank,
  formatTankReading,
  isUnusualPace,
  measuredIn,
  monthlyAverages,
  parseTankReading,
  recentPace,
  type TankPoint,
  tankStretches,
  usageWithin,
  verdictOf,
} from './tank'

const SEP = { startDate: '2026-08-10', endDate: '2026-09-10' }
const OCT = { startDate: '2026-09-10', endDate: '2026-10-10' }
const NOV = { startDate: '2026-10-10', endDate: '2026-11-10' }

const point = (
  id: number,
  date: string,
  liters: number,
  meterReplaced = false,
): TankPoint => ({ id, date, liters, meterReplaced })

/** 200 m³ in 31 days, then 180 m³ in 30 days. */
const POINTS = [
  point(1, '2026-08-10', 1_000_000),
  point(2, '2026-09-10', 1_200_000),
  point(3, '2026-10-10', 1_380_000),
]
const STRETCHES = tankStretches(POINTS)
/** A new meter in November. */
const REPLACED = [...POINTS, point(4, '2026-11-10', 20_000, true)]

function chacara(
  name: string,
  stretches: ChacaraMeter['stretches'],
  extra: Partial<ChacaraMeter> = {},
): ChacaraMeter {
  return {
    name,
    active: true,
    registeredOn: '2026-01-01',
    stretches,
    ...extra,
  }
}

const CHACARAS = [
  chacara('Chácara 1', [
    { ...SEP, consumption: 90 },
    { ...OCT, consumption: 80 },
  ]),
  // Read two days early: kept at its pace (2 m³ a day) until the end.
  chacara('Chácara 2', [
    { ...SEP, consumption: 70 },
    { startDate: '2026-09-10', endDate: '2026-10-08', consumption: 56 },
  ]),
  // No longer read: counts up to its last reading.
  chacara('Chácara 3', [{ ...SEP, consumption: 30 }], { active: false }),
  // Registered after these readings, never read.
  chacara('Chácara 4', [], { registeredOn: '2026-11-01' }),
  // First read after them.
  chacara('Chácara 5', [{ ...NOV, consumption: 12 }]),
]

describe('typing a reading of the tank', () => {
  test('in m³ with the liters', () => {
    expect(parseTankReading('1254,37')).toBe(1_254_370)
    expect(parseTankReading('1.254,37')).toBe(1_254_370)
    expect(parseTankReading('1254.37')).toBe(1_254_370)
    expect(parseTankReading('2418,655')).toBe(2_418_655)
    expect(parseTankReading(' 28 m³')).toBe(28_000)
    expect(parseTankReading('1254,')).toBe(1_254_000)
    expect(parseTankReading('')).toBeNull()
    expect(parseTankReading('12,3456')).toBeNull()
    expect(parseTankReading('doze')).toBeNull()
    expect(formatTankReading(1_254_370)).toBe('1.254,37')
    expect(formatTankReading(2_418_655)).toBe('2.418,655')
    expect(formatTankReading(28_000)).toBe('28')
  })
})

describe('the tank’s readings', () => {
  test('measure the water used from one to the next', () => {
    expect(STRETCHES).toEqual([
      { ...SEP, consumption: 200 },
      { ...OCT, consumption: 180 },
    ])
    // A new meter: the water used in between is unknown.
    expect(tankStretches(REPLACED).at(-1)).toEqual({
      ...NOV,
      consumption: null,
    })
  })

  test('a stretch partly inside a window counts by its days', () => {
    expect(usageWithin(STRETCHES, OCT)).toEqual({
      consumption: 180,
      days: 30,
      prorated: false,
      unknown: false,
    })
    // 16 of the 31 days of the first stretch and 15 of the 30 of the next.
    const usage = usageWithin(STRETCHES, {
      startDate: '2026-08-25',
      endDate: '2026-09-25',
    })
    expect(usage.consumption).toBeCloseTo((200 * 16) / 31 + 90, 6)
    expect(usage.prorated).toBe(true)
  })

  test('readings a few days short keep the pace of the last one', () => {
    // 5 days past the last reading, at 6 m³ a day.
    expect(
      measuredIn(STRETCHES, { startDate: '2026-09-15', endDate: '2026-10-15' }),
    ).toEqual({ status: 'ok', consumption: 150 + 30, estimated: true })
    // A month short: unknown until the next reading.
    expect(measuredIn(STRETCHES, NOV)).toEqual({ status: 'short' })
    expect(measuredIn(tankStretches(REPLACED), NOV)).toEqual({
      status: 'unknown',
    })
  })

  test('a pace far above the recent one is questioned', () => {
    // 380 m³ in 61 days.
    expect(recentPace(POINTS)).toBe(190)
    expect(isUnusualPace(400, 30, 190)).toBe(false)
    // An extra digit.
    expect(isUnusualPace(1900, 30, 190)).toBe(true)
  })
})

describe('verdictOf', () => {
  test('up to 10% (and 10 m³) of difference is normal', () => {
    expect(verdictOf(500, 470)).toEqual({
      difference: 30,
      share: 0.06,
      verdict: 'normal',
    })
    expect(verdictOf(500, 430).verdict).toBe('vazamento')
    expect(verdictOf(500, 560).verdict).toBe('conferir')
    // Small amounts: 10 m³ of margin.
    expect(verdictOf(40, 32).verdict).toBe('normal')
    expect(verdictOf(40, 25).verdict).toBe('vazamento')
    expect(verdictOf(0, 0)).toEqual({
      difference: 0,
      share: null,
      verdict: 'normal',
    })
  })
})

describe('chacarasWithin', () => {
  test('sums what the chácaras measured in the same days', () => {
    expect(chacarasWithin(CHACARAS, OCT)).toEqual({
      measured: { consumption: 80 + 60, estimated: true },
      missing: [],
      uncovered: false,
    })
  })

  test('waits for the chácaras not read up to the end', () => {
    expect(
      chacarasWithin(
        [
          chacara('Chácara 1', [{ ...OCT, consumption: 80 }]),
          chacara('Chácara 2', [{ ...SEP, consumption: 70 }]),
          // Registered before the end, never read.
          chacara('Chácara 6', [], { registeredOn: '2026-09-01' }),
        ],
        OCT,
      ),
    ).toEqual({
      measured: null,
      missing: ['Chácara 2', 'Chácara 6'],
      uncovered: false,
    })
  })

  test('nothing to compare before the chácaras’ first readings', () => {
    expect(
      chacarasWithin(CHACARAS, { ...SEP, startDate: '2026-07-10' }),
    ).toEqual({ measured: null, missing: [], uncovered: true })
    expect(chacarasWithin([], OCT).uncovered).toBe(true)
  })
})

describe('compareTank', () => {
  test('each reading of the tank against the chácaras', () => {
    const [oct, sep, first, ...rest] = compareTank(POINTS, CHACARAS)
    expect(rest).toEqual([])
    expect(first).toEqual({ ...point(1, '2026-08-10', 1_000_000), since: null })
    // 90 + 70 + 30 m³ in September.
    expect(sep?.since).toMatchObject({
      startDate: '2026-08-10',
      days: 31,
      consumption: 200,
      perMonth: 196,
      chacaras: { consumption: 190, estimated: false },
      result: { difference: 10, verdict: 'normal' },
    })
    expect(oct?.since).toMatchObject({
      consumption: 180,
      perMonth: 183,
      chacaras: { consumption: 140, estimated: true },
      result: { difference: 40, verdict: 'vazamento' },
    })
  })

  test('a tank read every few months is compared over those months', () => {
    const rows = compareTank(
      [point(1, '2026-07-10', 0), point(2, '2026-10-10', 600_000)],
      [
        chacara('Chácara 1', [
          { startDate: '2026-07-10', endDate: '2026-08-10', consumption: 100 },
          { ...SEP, consumption: 100 },
          { ...OCT, consumption: 100 },
        ]),
        // 92 of its 183 days.
        chacara('Chácara 2', [
          { startDate: '2026-06-10', endDate: '2026-12-10', consumption: 366 },
        ]),
      ],
    )
    expect(rows[0]?.since).toMatchObject({
      days: 92,
      consumption: 600,
      chacaras: { consumption: 484, estimated: true },
      result: { difference: 116, verdict: 'vazamento' },
    })
  })

  test('a new meter leaves its stretch out', () => {
    const [nov] = compareTank(REPLACED, CHACARAS)
    expect(nov?.since).toMatchObject({
      consumption: null,
      perMonth: null,
      chacaras: null,
      result: null,
    })
  })
})

describe('monthlyAverages', () => {
  test('the tank and the chácaras a month, in the same days', () => {
    // 380 m³, and 170 + 130 + 30 m³, in 61 days.
    expect(monthlyAverages(POINTS, CHACARAS)).toEqual({
      startDate: '2026-08-10',
      endDate: '2026-10-10',
      fullYear: false,
      tankPerMonth: 190,
      chacarasPerMonth: 165,
      missing: [],
      uncovered: false,
      result: { difference: 25, share: 25 / 190, verdict: 'vazamento' },
    })
    // Up to the newest reading compared: the new meter's has no consumption.
    expect(monthlyAverages(REPLACED, CHACARAS)).toMatchObject({
      endDate: '2026-10-10',
      tankPerMonth: 190,
      chacarasPerMonth: 165,
    })
    // A new meter within the 12 months: only the tank's average.
    const swapped = [
      point(1, '2026-08-10', 1_000_000),
      point(2, '2026-09-10', 4000, true),
      point(3, '2026-10-10', 184_000),
    ]
    expect(monthlyAverages(swapped, CHACARAS)).toMatchObject({
      startDate: '2026-08-10',
      endDate: '2026-10-10',
      tankPerMonth: 183,
      chacarasPerMonth: null,
      result: null,
    })
    expect(monthlyAverages(POINTS.slice(0, 1), CHACARAS)).toBeNull()
  })

  test('only the last 12 months count', () => {
    const years = [
      point(1, '2024-07-10', 0),
      point(2, '2025-07-10', 1_000_000),
      point(3, '2026-07-10', 2_200_000),
    ]
    expect(monthlyAverages(years, [])).toMatchObject({
      startDate: '2025-07-10',
      fullYear: true,
      tankPerMonth: 100,
      chacarasPerMonth: null,
      uncovered: true,
    })
  })
})

describe('checkTankReading', () => {
  const today = '2026-11-02'
  const check = (entry: Parameters<typeof checkTankReading>[1]) =>
    checkTankReading(POINTS, entry, today)

  test('fits among the other readings by date', () => {
    expect(check({ date: '2026-10-30', liters: 1_450_000 }).problem).toBeNull()
    expect(check({ date: '2026-11-10', liters: 1_450_000 }).problem).toContain(
      'é depois de hoje',
    )
    expect(check({ date: '2026-10-10', liters: 1_450_000 }).problem).toContain(
      'Já existe uma leitura da caixa d’água em 10/10/2026',
    )
    expect(check({ date: '2026-09-01', liters: 1_250_500 }).problem).toContain(
      'A leitura (1.250,5) é maior que a de 10/09/2026 (1.200)',
    )
  })

  test('lower than the reading before only with a new meter', () => {
    const lower = check({ date: '2026-10-20', liters: 30_000 })
    expect(lower.meterQuestion).toBe(true)
    expect(lower.problem).toContain('é menor que a de 10/10/2026 (1.380)')
    expect(
      check({ date: '2026-10-20', liters: 30_000, meterReplaced: true })
        .problem,
    ).toBeNull()
  })

  test('a correction is checked against the other readings', () => {
    expect(
      check({ id: 2, date: '2026-09-10', liters: 1_210_000 }),
    ).toMatchObject({
      before: { id: 1 },
      after: { id: 3 },
      meterQuestion: false,
      problem: null,
    })
  })
})
