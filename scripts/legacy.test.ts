import { describe, expect, test } from 'bun:test'
import {
  legacyMoneyToCents,
  legacyPriceToMicros,
  legacyPropertyName,
  parseLegacyDate,
  parseLegacyPeriod,
} from './legacy'

describe('parseLegacyPeriod', () => {
  test.each([
    ['10 Jan/10 Fev 2007', 2007, { year: 2007, month: 2 }],
    ['10 Abr/ 10Mai 2007', 2007, { year: 2007, month: 5 }],
    ['10 Abr/10  Mai 2007', 2007, { year: 2007, month: 5 }],
    ['10 Nov 07/ 10 Jan 08', 2007, { year: 2008, month: 1 }],
    ['10 Dez 08 / 10 jan 09', 2009, { year: 2009, month: 1 }],
    ['10 Jun 08 / 10 Lul 08', 2008, { year: 2008, month: 7 }],
    ['10  Fev 08 /10 Mar 08', 2008, { year: 2008, month: 3 }],
    ['10 Set 08 / 10 dez 08', 2008, { year: 2008, month: 12 }],
    ['10 Out / 10 Nov 2007', 2007, { year: 2007, month: 11 }],
  ])('%p → %p', (mes, fallback, expected) => {
    expect(parseLegacyPeriod(mes, fallback)).toEqual(expected)
  })

  test('falls back to the year column when the text has none', () => {
    expect(parseLegacyPeriod('10 Jan / 10 Fev', 2008)).toEqual({
      year: 2008,
      month: 2,
    })
    expect(parseLegacyPeriod('', 2008)).toBeNull()
  })
})

describe('legacy values', () => {
  test('dates are month-first', () => {
    expect(parseLegacyDate('02/15/07 00:00:00')).toBe('2007-02-15')
    expect(parseLegacyDate('')).toBeNull()
  })

  test('Access singles become exact integers', () => {
    expect(legacyPriceToMicros('0.34999999')).toBe(350000)
    expect(legacyPriceToMicros('0.34')).toBe(340000)
    expect(legacyMoneyToCents('10')).toBe(1000)
  })

  test('chácara names come from the address column', () => {
    expect(legacyPropertyName('Chácara 14', 'Helena')).toBe('Chácara 14')
    expect(legacyPropertyName('(12)', 'Otávio')).toBe('Chácara 12')
    expect(legacyPropertyName('13)', 'Rosa')).toBe('Chácara 13')
    expect(legacyPropertyName('Chácara', 'Teodoro')).toBe('Chácara Teodoro')
  })
})
