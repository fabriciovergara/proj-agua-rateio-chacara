/* Light formatting for Brazilian identifiers, applied while typing. */

const digitsOf = (value: string) => value.replace(/\D/g, '')

/** "19998765432" → "(19) 99876-5432"; "1932105555" → "(19) 3210-5555". */
export function formatPhone(value: string): string {
  const digits = digitsOf(value).slice(0, 11)
  if (digits.length <= 2) return digits.length ? `(${digits}` : ''
  const area = digits.slice(0, 2)
  const rest = digits.slice(2)
  if (rest.length <= 4) return `(${area}) ${rest}`
  const split = rest.length === 9 ? 5 : 4
  return `(${area}) ${rest.slice(0, split)}-${rest.slice(split)}`
}

/** "13250000" → "13250-000" */
export function formatCep(value: string): string {
  const digits = digitsOf(value).slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

/**
 * "10092026" → "10/09/2026": the slashes appear while typing. A slash typed
 * after a single digit pads it ("1/" → "01").
 */
export function formatDateTyping(value: string): string {
  const padded = value.replace(
    /(^|\/)(\d)\/$/,
    (_, before: string, digit: string) => `${before}0${digit}/`,
  )
  const digits = digitsOf(padded).slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/**
 * CPF and CNPJ get their usual punctuation; anything else (RG, passport) is
 * kept exactly as typed.
 */
export function formatDocument(value: string): string {
  const trimmed = value.trim()
  const digits = digitsOf(trimmed)
  if (/[^\d.\-/\s]/.test(trimmed)) return trimmed
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  }
  if (digits.length === 14) {
    return digits.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      '$1.$2.$3/$4-$5',
    )
  }
  return trimmed
}

/** Lowercase without accents, for "search anything" boxes. */
export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** True when every word typed appears somewhere in the given fields. */
export function matchesSearch(
  query: string,
  fields: Array<string | number | null | undefined>,
): boolean {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = normalizeForSearch(
    fields.filter((field) => field != null).join(' '),
  )
  const haystackDigits = haystack.replace(/\D/g, '')
  return words.every((word) => {
    if (haystack.includes(word)) return true
    // "13250000" should find "13250-000"; "99876" should find "(19) 99876-…".
    const wordDigits = word.replace(/\D/g, '')
    return wordDigits.length >= 3 && haystackDigits.includes(wordDigits)
  })
}

/** Link that opens WhatsApp with the owner's number (Brazil, +55). */
export function whatsappLink(phone: string | null, text: string): string {
  const digits = digitsOf(phone ?? '')
  const number =
    digits.length >= 10
      ? digits.startsWith('55') && digits.length > 11
        ? digits
        : `55${digits}`
      : ''
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`
}
