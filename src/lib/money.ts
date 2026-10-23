/*
 * Brazilian money helpers. Amounts travel through the app as integers:
 * centavos for R$ values and micros (millionths of a real) for the price of
 * a m³, which needs more than two decimal places.
 */

const MICROS_PER_REAL = 1_000_000
/** The price of a m³ is shown with up to 4 decimal places. */
export const PRICE_DECIMALS = 4

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const brlPrice = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: PRICE_DECIMALS,
})

const decimal2 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** 123456 → "R$ 1.234,56" */
export function formatBRL(cents: number): string {
  return brl.format(cents / 100)
}

/** 350000 → "R$ 0,35"; 4852900 → "R$ 4,8529" */
export function formatUnitPrice(micros: number): string {
  return brlPrice.format(micros / MICROS_PER_REAL)
}

/** 1234 → "1.234" (meter readings and m³). */
export function formatNumber(value: number): string {
  return integer.format(value)
}

/** Value to pre-fill a money input: 123456 → "1.234,56". */
export function centsToInput(cents: number | null | undefined): string {
  return cents == null ? '' : decimal2.format(cents / 100)
}

/**
 * Parses what a person types into a money field ("1.234,56", "R$ 10", "0,35",
 * "12.5") into an integer scaled by 10^scale, rounding half up.
 * Returns `null` for empty or invalid input.
 */
export function parseScaledDecimal(
  input: string,
  scale: number,
): number | null {
  let text = input.replace(/R\$|\s/g, '')
  if (text === '') return null

  if (text.includes(',')) {
    // pt-BR: dots group thousands, the comma separates decimals.
    text = text.replace(/\./g, '').replace(',', '.')
  } else {
    const dots = text.split('.').length - 1
    const [head, tail] = text.split('.')
    // "1.234.567" groups thousands. So does "1.500" in a money field, but
    // with more decimals (a unit price) "1.234" is R$ 1,234.
    const groupsThousands =
      dots === 1 && tail?.length === 3 && head !== '0' && scale <= 2
    if (dots > 1 || groupsThousands) {
      text = text.replace(/\./g, '')
    }
  }

  if (!/^\d+(\.\d+)?$/.test(text)) return null

  const [intPart, fracPart = ''] = text.split('.')
  const kept = fracPart.slice(0, scale).padEnd(scale, '0')
  const roundUp = fracPart.length > scale && Number(fracPart[scale]) >= 5
  const value =
    Number(intPart) * 10 ** scale + Number(kept || '0') + (roundUp ? 1 : 0)

  return Number.isSafeInteger(value) ? value : null
}

/** "1.234,56" → 123456 centavos. */
export function parseCents(input: string): number | null {
  return parseScaledDecimal(input, 2)
}

/** "R$ 12,34" → "12.34", the amount format used by Pix QR codes. */
export function centsToPixAmount(cents: number): string {
  const reais = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, '0')
  return `${reais}.${rest}`
}
