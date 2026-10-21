/** A billing month. `month` is 1–12. */
export interface Period {
  year: number
  month: number
}

export const TIME_ZONE = 'America/Sao_Paulo'

export const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const

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

/** { 2026, 10 } → "Outubro de 2026" */
export function formatPeriod({ year, month }: Period): string {
  return `${MONTH_NAMES[month - 1]} de ${year}`
}

/** { 2026, 10 } → "out/2026" */
export function formatPeriodShort({ year, month }: Period): string {
  return `${MONTH_SHORT[month - 1]}/${year}`
}

export function addMonths({ year, month }: Period, delta: number): Period {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** Negative when `a` comes before `b`. */
export function comparePeriods(a: Period, b: Period): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month)
}

export function periodKey({ year, month }: Period): string {
  return `${year}-${String(month).padStart(2, '0')}`
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

/** The current month in Brazil (the server may run in another time zone). */
export function currentPeriod(now = new Date()): Period {
  const { year, month } = datePartsInTimeZone(now, TIME_ZONE)
  return { year, month }
}

/** Today's date in Brazil as YYYY-MM-DD. */
export function todayISO(now = new Date()): string {
  const { year, month, day } = datePartsInTimeZone(now, TIME_ZONE)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "2026-10-05" → "05/10/2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

/**
 * Bills for a month are due on `dueDay` of the following month
 * (clamped to the last day, e.g. day 31 in February becomes 28/29).
 */
export function dueDateFor(period: Period, dueDay: number): string {
  const next = addMonths(period, 1)
  const lastDay = new Date(Date.UTC(next.year, next.month, 0)).getUTCDate()
  const day = Math.min(Math.max(dueDay, 1), lastDay)
  return `${next.year}-${String(next.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
