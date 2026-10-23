import { describe, expect, test } from 'bun:test'
import {
  formatCep,
  formatDateTyping,
  formatDocument,
  formatPhone,
  matchesSearch,
  whatsappLink,
} from './masks'

describe('masks', () => {
  test('formats phones while typing', () => {
    expect(formatPhone('1')).toBe('(1')
    expect(formatPhone('19')).toBe('(19')
    expect(formatPhone('199')).toBe('(19) 9')
    expect(formatPhone('19998765432')).toBe('(19) 99876-5432')
    expect(formatPhone('1932105555')).toBe('(19) 3210-5555')
    expect(formatPhone('(19) 99876-54321')).toBe('(19) 99876-5432')
  })

  test('formats CEP', () => {
    expect(formatCep('13250')).toBe('13250')
    expect(formatCep('13250000')).toBe('13250-000')
  })

  test('formats dates while typing', () => {
    expect(formatDateTyping('1')).toBe('1')
    expect(formatDateTyping('100')).toBe('10/0')
    expect(formatDateTyping('10092026')).toBe('10/09/2026')
    expect(formatDateTyping('10/09/20261')).toBe('10/09/2026')
    expect(formatDateTyping('1/')).toBe('01')
    expect(formatDateTyping('01/9/')).toBe('01/09')
  })

  test('formats CPF and CNPJ, keeps other documents', () => {
    expect(formatDocument('12345678909')).toBe('123.456.789-09')
    expect(formatDocument('12345678000199')).toBe('12.345.678/0001-99')
    expect(formatDocument('RG 12.345.678-X')).toBe('RG 12.345.678-X')
  })
})

describe('matchesSearch', () => {
  const fields = ['Chácara 14', 'Helena Souza', '(19) 99876-5432', '13250-000']

  test('ignores accents and case', () => {
    expect(matchesSearch('chacara helena', fields)).toBe(true)
    expect(matchesSearch('CHÁCARA 14', fields)).toBe(true)
    expect(matchesSearch('maria', fields)).toBe(false)
  })

  test('finds numbers without punctuation', () => {
    expect(matchesSearch('99876', fields)).toBe(true)
    expect(matchesSearch('13250000', fields)).toBe(true)
  })

  test('an empty search matches everything', () => {
    expect(matchesSearch('  ', fields)).toBe(true)
  })
})

describe('whatsappLink', () => {
  test('adds the Brazilian country code', () => {
    expect(whatsappLink('(19) 99876-5432', 'Olá')).toBe(
      'https://wa.me/5519998765432?text=Ol%C3%A1',
    )
  })

  test('opens the contact picker when there is no phone', () => {
    expect(whatsappLink(null, 'Oi')).toBe('https://wa.me/?text=Oi')
  })
})
