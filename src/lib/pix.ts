import type { PixKeyType } from './domain'
import { centsToPixAmount } from './money'

/*
 * Static Pix QR code ("BR Code"), following the Banco Central "Manual de
 * Padrões para Iniciação do Pix": EMV fields written as ID + length + value,
 * closed by a CRC16-CCITT checksum.
 */

export interface PixPayloadInput {
  key: string
  keyType: PixKeyType
  /** Beneficiary name, up to 25 characters. */
  name: string
  /** Beneficiary city, up to 15 characters. */
  city: string
  amountCents?: number
  /** Optional message shown by some banking apps. */
  description?: string
  /** Transaction id, letters and digits only; "***" when absent. */
  txid?: string
}

/** Longest key that fits the 99-character account block with the GUI. */
export const MAX_PIX_KEY_LENGTH = 77

function field(id: string, value: string): string {
  // EMV lengths have two digits: a longer value would corrupt the code.
  if (value.length > 99) {
    throw new Error(`Campo ${id} do Pix passa de 99 caracteres.`)
  }
  return `${id}${String(value.length).padStart(2, '0')}${value}`
}

/** Banking apps expect plain ASCII in the name and city fields. */
function toAscii(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
}

/** Normalizes a Pix key the way the Pix directory stores it. */
export function normalizePixKey(key: string, type: PixKeyType): string {
  const trimmed = key.trim()
  switch (type) {
    case 'cpf':
    case 'cnpj':
      return trimmed.replace(/\D/g, '')
    case 'telefone': {
      const digits = trimmed.replace(/\D/g, '')
      return digits.startsWith('55') && digits.length >= 12
        ? `+${digits}`
        : `+55${digits}`
    }
    case 'email':
    case 'aleatoria':
      return trimmed.toLowerCase()
  }
}

/** Returns a message describing what is wrong with the key, or null when valid. */
export function validatePixKey(key: string, type: PixKeyType): string | null {
  const normalized = normalizePixKey(key, type)
  switch (type) {
    case 'cpf':
      return normalized.length === 11 ? null : 'O CPF deve ter 11 números.'
    case 'cnpj':
      return normalized.length === 14 ? null : 'O CNPJ deve ter 14 números.'
    case 'telefone':
      return /^\+55\d{10,11}$/.test(normalized)
        ? null
        : 'Informe o celular com DDD, por exemplo (19) 99999-9999.'
    case 'email':
      if (normalized.length > MAX_PIX_KEY_LENGTH) {
        return `A chave Pix pode ter no máximo ${MAX_PIX_KEY_LENGTH} caracteres.`
      }
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
        ? null
        : 'Informe um e-mail válido.'
    case 'aleatoria':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        normalized,
      )
        ? null
        : 'A chave aleatória tem 32 letras e números separados por hífens.'
  }
}

export function crc16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Builds the "Pix copia e cola" text, which is also what the QR code encodes. */
export function buildPixPayload(input: PixPayloadInput): string {
  const key = normalizePixKey(input.key, input.keyType)
  const name = toAscii(input.name).slice(0, 25)
  const city = toAscii(input.city).toUpperCase().slice(0, 15)
  const txid = input.txid?.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'

  const gui = field('00', 'br.gov.bcb.pix')
  const keyField = field('01', key)
  // The merchant account block (ID 26) holds at most 99 characters.
  const room = 99 - gui.length - keyField.length - 4
  const description = toAscii(input.description ?? '')
    .replace(/[^A-Za-z0-9 ./-]/g, '')
    .slice(0, Math.max(room, 0))
  const account = gui + keyField + (description ? field('02', description) : '')

  const payload = [
    field('00', '01'),
    field('26', account),
    field('52', '0000'),
    field('53', '986'),
    input.amountCents && input.amountCents > 0
      ? field('54', centsToPixAmount(input.amountCents))
      : '',
    field('58', 'BR'),
    field('59', name),
    field('60', city),
    field('62', field('05', txid)),
    '6304',
  ].join('')

  return payload + crc16(payload)
}

/** Like buildPixPayload, but returns null instead of throwing (bad key). */
export function tryBuildPixPayload(input: PixPayloadInput): string | null {
  try {
    return buildPixPayload(input)
  } catch {
    return null
  }
}
