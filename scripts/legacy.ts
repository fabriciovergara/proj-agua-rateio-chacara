/*
 * Helpers to read the CSV exports of the original Microsoft Access app
 * (Kw.mdb: tables T_Usuarios, T_Fatura and T_Cosumo).
 */
import type { Period } from '#/lib/periods'

const MONTHS: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  lul: 7, // typo found in the old data ("10 Jun 08 / 10 Lul 08")
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
}

/**
 * The old "Mes" column describes the reading period, e.g. "10 Jan/10 Fev
 * 2007" or "10 Nov 07 / 10 Jan 08". The bill belongs to the month the
 * period ends in (when the meter was read).
 */
export function parseLegacyPeriod(
  mes: string,
  fallbackYear: number | null,
): Period | null {
  const pattern =
    /(jan|fev|mar|abr|mai|jun|jul|lul|ago|set|out|nov|dez)[a-zç]*\.?\s*(\d{4}|\d{2}(?!\d))?/gi
  const matches = [...mes.matchAll(pattern)]
  const last = matches.at(-1)
  if (!last?.[1]) return null

  const month = MONTHS[last[1].toLowerCase()]
  if (!month) return null

  let year: number | null = null
  if (last[2]) {
    year = last[2].length === 2 ? 2000 + Number(last[2]) : Number(last[2])
  } else {
    const fourDigits = mes.match(/\d{4}/g)?.at(-1)
    year = fourDigits ? Number(fourDigits) : fallbackYear
  }
  return year ? { year, month } : null
}

/** "02/15/07 00:00:00" (Access export, month first) → "2007-02-15". */
export function parseLegacyDate(value: string | undefined): string | null {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{2,4})/)
  if (!match) return null
  const [, month, day, year] = match
  const fullYear = year?.length === 2 ? `20${year}` : year
  return `${fullYear}-${month}-${day}`
}

/** "0.34999999" (Access Single) → 350000 micros, rounded to 4 decimals. */
export function legacyPriceToMicros(value: string): number {
  return Math.round(Number(value) * 10_000) * 100
}

/** "10" → 1000 centavos. */
export function legacyMoneyToCents(value: string): number {
  return Math.round(Number(value) * 100)
}

/**
 * The old app kept the chácara in the address column: "Chácara 29",
 * "(27)", "28)". When there is no number, the owner's name identifies it.
 */
export function legacyPropertyName(address: string, ownerName: string): string {
  const number = address.match(/\d+/)?.[0]
  return number ? `Chácara ${Number(number)}` : `Chácara ${ownerName.trim()}`
}
