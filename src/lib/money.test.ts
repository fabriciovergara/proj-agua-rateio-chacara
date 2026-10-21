import { describe, expect, test } from 'bun:test'
import {
  centsToInput,
  centsToPixAmount,
  formatBRL,
  formatKwhPrice,
  microsToInput,
  parseCents,
  parsePriceMicros,
} from './money'

const nbsp = ' '

describe('formatting', () => {
  test('formats centavos as reais', () => {
    expect(formatBRL(123456)).toBe(`R$${nbsp}1.234,56`)
    expect(formatBRL(1000)).toBe(`R$${nbsp}10,00`)
    expect(formatBRL(0)).toBe(`R$${nbsp}0,00`)
  })

  test('formats the kWh price with 2 to 4 decimals', () => {
    expect(formatKwhPrice(350000)).toBe(`R$${nbsp}0,35`)
    expect(formatKwhPrice(874300)).toBe(`R$${nbsp}0,8743`)
  })

  test('pre-fills inputs in the Brazilian format', () => {
    expect(centsToInput(123456)).toBe('1.234,56')
    expect(centsToInput(null)).toBe('')
    expect(microsToInput(350000)).toBe('0,35')
    expect(microsToInput(874300)).toBe('0,8743')
  })

  test('formats Pix amounts with a dot and two decimals', () => {
    expect(centsToPixAmount(4825)).toBe('48.25')
    expect(centsToPixAmount(5)).toBe('0.05')
    expect(centsToPixAmount(100000)).toBe('1000.00')
  })
})

describe('parseCents', () => {
  test.each([
    ['10', 1000],
    ['10,5', 1050],
    ['10,50', 1050],
    ['R$ 1.234,56', 123456],
    ['1.234', 123400],
    ['1.234.567,89', 123456789],
    ['12.5', 1250],
    ['0.35', 35],
    ['0,355', 36],
    ['  7 ', 700],
  ])('%p → %p', (input, expected) => {
    expect(parseCents(input)).toBe(expected)
  })

  test.each(['', 'abc', '1,2,3', '-5', '1e3'])('rejects %p', (input) => {
    expect(parseCents(input)).toBeNull()
  })
})

describe('parsePriceMicros', () => {
  test.each([
    ['0,35', 350000],
    ['0.35', 350000],
    ['0,8743', 874300],
    ['0,87435', 874400],
    ['1', 1000000],
    ['R$ 0,6', 600000],
    // A dot with 3 decimals is a price, not a thousands separator.
    ['1.234', 1234000],
    ['1,234', 1234000],
  ])('%p → %p', (input, expected) => {
    expect(parsePriceMicros(input)).toBe(expected)
  })
})
