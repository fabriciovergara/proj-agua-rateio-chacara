import { describe, expect, test } from 'bun:test'
import {
  addMonths,
  comparePeriods,
  currentPeriod,
  dueDateFor,
  formatDate,
  formatPeriod,
  formatPeriodShort,
  todayISO,
} from './periods'

describe('periods', () => {
  test('formats months in Portuguese', () => {
    expect(formatPeriod({ year: 2026, month: 10 })).toBe('Outubro de 2026')
    expect(formatPeriodShort({ year: 2026, month: 3 })).toBe('mar/2026')
  })

  test('adds months across years', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    })
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    })
    expect(addMonths({ year: 2026, month: 5 }, -17)).toEqual({
      year: 2024,
      month: 12,
    })
  })

  test('compares periods', () => {
    expect(
      comparePeriods({ year: 2025, month: 12 }, { year: 2026, month: 1 }),
    ).toBeLessThan(0)
    expect(
      comparePeriods({ year: 2026, month: 2 }, { year: 2026, month: 2 }),
    ).toBe(0)
  })

  test('uses the Brazilian clock for "today"', () => {
    // 02:00 UTC on Nov 1st is still Oct 31st in São Paulo (UTC−3).
    const instant = new Date('2026-11-01T02:00:00Z')
    expect(currentPeriod(instant)).toEqual({ year: 2026, month: 10 })
    expect(todayISO(instant)).toBe('2026-10-31')
  })

  test('formats ISO dates as dd/mm/aaaa', () => {
    expect(formatDate('2026-10-05')).toBe('05/10/2026')
    expect(formatDate(null)).toBe('')
  })

  test('due date falls in the following month, clamped to its length', () => {
    expect(dueDateFor({ year: 2026, month: 10 }, 10)).toBe('2026-11-10')
    expect(dueDateFor({ year: 2026, month: 12 }, 5)).toBe('2027-01-05')
    expect(dueDateFor({ year: 2027, month: 1 }, 31)).toBe('2027-02-28')
  })
})
