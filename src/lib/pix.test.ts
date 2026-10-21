import { describe, expect, test } from 'bun:test'
import {
  buildPixPayload,
  crc16,
  normalizePixKey,
  tryBuildPixPayload,
  validatePixKey,
} from './pix'

describe('buildPixPayload', () => {
  test('reproduces the example from the Banco Central manual', () => {
    expect(
      buildPixPayload({
        key: '123e4567-e12b-12d1-a456-426655440000',
        keyType: 'aleatoria',
        name: 'Fulano de Tal',
        city: 'BRASILIA',
      }),
    ).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
    )
  })

  test('includes the amount, plain-ASCII name/city and a valid checksum', () => {
    const payload = buildPixPayload({
      key: '(19) 99876-5432',
      keyType: 'telefone',
      name: 'Associação das Chácaras São João',
      city: 'Itatiba',
      amountCents: 4825,
      description: 'Chácara 29 out/2026',
    })
    expect(payload).toContain('0114+5519998765432')
    expect(payload).toContain('540548.25')
    expect(payload).toContain('5925Associacao das Chacaras ')
    expect(payload).toContain('6007ITATIBA')
    expect(payload).toContain('0219Chacara 29 out/2026')
    const body = payload.slice(0, -4)
    expect(payload.slice(-4)).toBe(crc16(body))
  })

  test('keeps the merchant account block within 99 characters', () => {
    const payload = buildPixPayload({
      key: '123e4567-e12b-12d1-a456-426655440000',
      keyType: 'aleatoria',
      name: 'X',
      city: 'Y',
      description: 'a'.repeat(200),
    })
    // "000201" is followed by the merchant account block: "26" + length.
    const accountLength = Number(payload.slice(8, 10))
    expect(payload.slice(6, 8)).toBe('26')
    expect(accountLength).toBeLessThanOrEqual(99)
  })
})

describe('Pix keys', () => {
  test('normalizes keys by type', () => {
    expect(normalizePixKey('123.456.789-09', 'cpf')).toBe('12345678909')
    expect(normalizePixKey('+55 (19) 99876-5432', 'telefone')).toBe(
      '+5519998765432',
    )
    expect(normalizePixKey(' Pix@Exemplo.com ', 'email')).toBe(
      'pix@exemplo.com',
    )
  })

  test('explains invalid keys', () => {
    expect(validatePixKey('123', 'cpf')).toBe('O CPF deve ter 11 números.')
    expect(validatePixKey('123.456.789-09', 'cpf')).toBeNull()
    expect(validatePixKey('19 99876-5432', 'telefone')).toBeNull()
    expect(validatePixKey('nao-e-email', 'email')).not.toBeNull()
  })
})

describe('long keys', () => {
  // 78 characters: one more than fits in the merchant account block.
  const longEmail = `${'a'.repeat(66)}@exemplo.com`

  test('are rejected before they can break the QR code', () => {
    expect(longEmail.length).toBe(78)
    expect(validatePixKey(longEmail, 'email')).toBe(
      'A chave Pix pode ter no máximo 77 caracteres.',
    )
    const input = {
      key: longEmail,
      keyType: 'email' as const,
      name: 'X',
      city: 'Y',
    }
    expect(() => buildPixPayload(input)).toThrow()
    expect(tryBuildPixPayload(input)).toBeNull()
  })

  test('a 77-character key still fits', () => {
    const payload = buildPixPayload({
      key: longEmail.slice(1),
      keyType: 'email',
      name: 'X',
      city: 'Y',
      description: 'descricao longa que nao cabe',
    })
    expect(Number(payload.slice(8, 10))).toBe(99)
  })
})
