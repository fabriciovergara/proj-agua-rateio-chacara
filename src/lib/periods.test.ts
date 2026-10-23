import { describe, expect, test } from 'bun:test'
import {
  addMonthsToDate,
  dueDateFor,
  formatDate,
  formatDateRange,
  formatDateRangeShort,
  formatMonthYear,
  isISODate,
  parseDate,
  rangesOverlap,
  todayISO,
  yearOf,
} from './periods'

describe('dates', () => {
  test('formats ISO dates as dd/mm/aaaa', () => {
    expect(formatDate('2026-10-05')).toBe('05/10/2026')
    expect(formatDate(null)).toBe('')
    expect(
      formatDateRange({ startDate: '2026-09-10', endDate: '2026-10-10' }),
    ).toBe('10/09/2026 a 10/10/2026')
    expect(
      formatDateRangeShort({ startDate: '2026-09-10', endDate: '2026-10-10' }),
    ).toBe('10/09 a 10/10/2026')
    expect(
      formatDateRangeShort({ startDate: '2025-12-10', endDate: '2026-01-10' }),
    ).toBe('10/12/2025 a 10/01/2026')
    expect(formatMonthYear('2026-03-10')).toBe('mar/2026')
    expect(yearOf('2026-03-10')).toBe(2026)
  })

  test('reads what is typed, refusing dates that do not exist', () => {
    expect(parseDate('10/09/2026')).toBe('2026-09-10')
    expect(parseDate(' 5/1/2027 ')).toBe('2027-01-05')
    expect(parseDate('29/02/2028')).toBe('2028-02-29')
    expect(parseDate('29/02/2027')).toBeNull()
    expect(parseDate('31/04/2026')).toBeNull()
    expect(parseDate('10/13/2026')).toBeNull()
    expect(parseDate('10/09/26')).toBeNull()
    expect(parseDate('')).toBeNull()
    expect(isISODate('2026-02-30')).toBe(false)
    expect(isISODate('2026-12-31')).toBe(true)
  })

  test('adds months, keeping the day when the month has it', () => {
    expect(addMonthsToDate('2026-09-10', 1)).toBe('2026-10-10')
    expect(addMonthsToDate('2026-12-10', 1)).toBe('2027-01-10')
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsToDate('2026-03-10', -3)).toBe('2025-12-10')
  })

  test('uses the Brazilian clock for "today"', () => {
    // 02:00 UTC on Nov 1st is still Oct 31st in São Paulo (UTC−3).
    expect(todayISO(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10-31')
  })

  test('periods may share the boundary day, not more', () => {
    const september = { startDate: '2026-09-10', endDate: '2026-10-10' }
    expect(
      rangesOverlap(september, {
        startDate: '2026-10-10',
        endDate: '2026-11-10',
      }),
    ).toBe(false)
    expect(
      rangesOverlap(september, {
        startDate: '2026-10-09',
        endDate: '2026-11-10',
      }),
    ).toBe(true)
  })

  test('due date falls in the month after the period ends', () => {
    expect(dueDateFor('2026-10-10', 10)).toBe('2026-11-10')
    expect(dueDateFor('2026-12-10', 5)).toBe('2027-01-05')
    expect(dueDateFor('2027-01-10', 31)).toBe('2027-02-28')
  })
})
