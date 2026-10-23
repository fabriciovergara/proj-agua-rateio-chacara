import { describe, expect, test } from 'bun:test'
import { centsToCsv, toCsv } from './csv'

describe('csv', () => {
  test('uses semicolons, quotes when needed and starts with a BOM', () => {
    expect(
      toCsv([
        ['Chácara', 'Total'],
        ['Recanto; "Verde"', '10,50'],
      ]),
    ).toBe('﻿Chácara;Total\r\n"Recanto; ""Verde""";10,50')
  })

  test('writes numbers with comma decimals and no thousands separator', () => {
    expect(centsToCsv(123456)).toBe('1234,56')
    expect(centsToCsv(5)).toBe('0,05')
  })
})
