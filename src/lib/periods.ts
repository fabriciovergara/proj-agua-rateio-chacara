/*
 * Dates and billing periods. Dates travel through the app as ISO strings
 * (YYYY-MM-DD), which also sort and compare correctly as text, and are
 * shown and typed the Brazilian way (DD/MM/AAAA).
 */

/** From the day the meters were read before to the day they are read now. */
export interface DateRange {
  startDate: string
  endDate: string
}

export const TIME_ZONE = 'America/Sao_Paulo'

export const MONTH_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const

const pad = (value: number, length = 2) => String(value).padStart(length, '0')

function toISO(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

function partsOf(iso: string) {
  const [year = 0, month = 0, day = 0] = iso.split('-').map(Number)
  return { year, month, day }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** True for a real calendar date written as YYYY-MM-DD (never 31/02). */
export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const { year, month, day } = partsOf(value)
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
  )
}

function datePartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** Today's date in Brazil (the server may run in another time zone). */
export function todayISO(now = new Date()): string {
  const { year, month, day } = datePartsInTimeZone(now, TIME_ZONE)
  return toISO(year, month, day)
}

/** "2026-10-05" → 2026 */
export function yearOf(iso: string): number {
  return partsOf(iso).year
}

/** "2026-10-05" → "05/10/2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const { year, month, day } = partsOf(iso)
  return `${pad(day)}/${pad(month)}/${pad(year, 4)}`
}

/** "10/09/2026 a 10/10/2026" */
export function formatDateRange({ startDate, endDate }: DateRange): string {
  return `${formatDate(startDate)} a ${formatDate(endDate)}`
}

/** "10/09 a 10/10/2026", or with both years when they differ. */
export function formatDateRangeShort(range: DateRange): string {
  return yearOf(range.startDate) === yearOf(range.endDate)
    ? `${formatDate(range.startDate).slice(0, 5)} a ${formatDate(range.endDate)}`
    : formatDateRange(range)
}

/** "2026-10-05" → "out/2026" */
export function formatMonthYear(iso: string): string {
  const { year, month } = partsOf(iso)
  return `${MONTH_SHORT[month - 1]}/${year}`
}

/** What a person typed ("5/10/2026", "05/10/2026") → "2026-10-05", or null. */
export function parseDate(text: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim())
  if (!match) return null
  const iso = toISO(Number(match[3]), Number(match[2]), Number(match[1]))
  return isISODate(iso) ? iso : null
}

/**
 * Moves a date by whole months, keeping the day when the month has it
 * (31/01 + 1 month → 28/02).
 */
export function addMonthsToDate(iso: string, months: number): string {
  const { year, month, day } = partsOf(iso)
  const index = year * 12 + (month - 1) + months
  const targetYear = Math.floor(index / 12)
  const targetMonth = (index % 12) + 1
  return toISO(
    targetYear,
    targetMonth,
    Math.min(day, daysInMonth(targetYear, targetMonth)),
  )
}

/**
 * The bills of a period are due on `dueDay` of the month after the period
 * ends (clamped to the month's length: day 31 in February becomes 28/29).
 */
export function dueDateFor(endDate: string, dueDay: number): string {
  const { year, month } = partsOf(addMonthsToDate(endDate, 1))
  const day = Math.min(Math.max(dueDay, 1), daysInMonth(year, month))
  return toISO(year, month, day)
}

/** Two ranges share at least one day besides a common boundary. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate < b.endDate && b.startDate < a.endDate
}
