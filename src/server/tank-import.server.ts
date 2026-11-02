import type { Executor } from '#/db/client.server'
import { tankReadings } from '#/db/schema'
import { UserFacingError } from '#/lib/errors'
import { formatDate, isISODate, parseDate } from '#/lib/periods'
import {
  checkTankReading,
  formatTankReading,
  MAX_TANK_LITERS,
  parseTankReading,
  type TankIssue,
  type TankPoint,
} from '#/lib/tank'
import { listTankReadings, syncReplacedMeters } from './tank.server'
import { type CellValue, readXlsx, type Sheet } from './xlsx.server'

/*
 * Readings of the caixa d'água kept in a spreadsheet before the app had
 * them: a "Data" row and a "Leitura" row with the values to their right, or
 * a "Data" column and a "Leitura" column with the values below.
 */

export interface TankSheet {
  /** The sheet they came from. */
  sheet: string
  readings: Array<{ date: string; liters: number }>
  /** Values that could not be read, in plain words. */
  unreadable: string[]
}

const plain = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()

const isLabel = (value: CellValue, word: RegExp) =>
  typeof value === 'string' && word.test(plain(value))

/** Days since 30/12/1899: how Excel keeps dates. */
function fromSerial(serial: number): string | null {
  if (serial < 1 || serial > 2_958_465) return null
  const day = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000)
  return day.toISOString().slice(0, 10)
}

function dateOf(value: CellValue): string | null {
  if (typeof value === 'number') return fromSerial(value)
  const text = value.trim()
  const iso = text.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return isISODate(iso) ? iso : null
  // "18/06/19": this century.
  const short = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(text)
  return parseDate(short ? `${short[1]}/${short[2]}/20${short[3]}` : text)
}

function litersOf(value: CellValue): number | null {
  if (typeof value === 'string') return parseTankReading(value)
  const liters = Math.round(value * 1000)
  return liters >= 0 && liters <= MAX_TANK_LITERS ? liters : null
}

/** 0 → "A", 26 → "AA". */
function columnName(col: number): string {
  let name = ''
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  }
  return name
}

/** A "Data" label with a "Leitura" one in the same row or column. */
function labelsOf(sheet: Sheet) {
  const values = sheet.cells.filter((cell) => isLabel(cell.value, /^leitura/))
  for (const date of sheet.cells) {
    if (!isLabel(date.value, /^data\b/)) continue
    const value = values.find(
      (cell) => cell.col === date.col || cell.row === date.row,
    )
    if (value) return { date, value }
  }
  return null
}

function readingsIn(sheet: Sheet): TankSheet | null {
  const labels = labelsOf(sheet)
  if (!labels) return null

  // Side by side in rows (values to the right) or in columns (below).
  const across = labels.date.col === labels.value.col
  const at = new Map(
    sheet.cells.map((cell) => [`${cell.row}:${cell.col}`, cell.value]),
  )
  const cellAt = (label: { row: number; col: number }, index: number) =>
    across ? at.get(`${label.row}:${index}`) : at.get(`${index}:${label.col}`)
  const first = (across ? labels.date.col : labels.date.row) + 1
  const last = Math.max(
    ...sheet.cells.map((cell) => (across ? cell.col : cell.row)),
  )

  const result: TankSheet = { sheet: sheet.name, readings: [], unreadable: [] }
  for (let index = first; index <= last; index++) {
    const dateCell = cellAt(labels.date, index)
    const valueCell = cellAt(labels.value, index)
    if (dateCell === undefined && valueCell === undefined) continue
    const date = dateCell === undefined ? null : dateOf(dateCell)
    const liters = valueCell === undefined ? null : litersOf(valueCell)
    if (date && liters !== null) {
      result.readings.push({ date, liters })
      continue
    }
    const where = across ? `Coluna ${columnName(index)}` : `Linha ${index + 1}`
    result.unreadable.push(
      !date
        ? dateCell === undefined
          ? `${where}: leitura sem data`
          : `${where}: a data “${dateCell}” não foi entendida`
        : valueCell === undefined
          ? `${where}: ${formatDate(date)} sem leitura`
          : `${where}: a leitura “${valueCell}” não foi entendida`,
    )
  }
  return result
}

/**
 * The tank's readings in an .xlsx, or null when the file is not a
 * spreadsheet.
 */
export function readTankSheet(bytes: Uint8Array): TankSheet | null {
  const sheets = readXlsx(bytes)
  if (!sheets) return null
  for (const sheet of sheets) {
    const found = readingsIn(sheet)
    if (found) return found
  }
  throw new UserFacingError(
    'A planilha precisa de uma linha (ou coluna) “Data” e outra “Leitura”, com as leituras da caixa d’água.',
  )
}

export interface TankImportResult {
  /** Readings that came in. */
  added: number
  /** Days the app already had a reading for: they stay as they are. */
  existing: number
  skipped: string[]
}

function reason(
  issue: TankIssue,
  before: TankPoint | undefined,
  after: TankPoint | undefined,
) {
  const of = (point: TankPoint | undefined) =>
    point
      ? `a de ${formatDate(point.date)} (${formatTankReading(point.liters)} m³)`
      : 'a anterior'
  switch (issue) {
    case 'future':
      return 'a data é depois de hoje; não foi importada'
    case 'lower':
      return `é menor que ${of(before)}; não foi importada (se o hidrômetro foi trocado, lance-a na tela Caixa d’água)`
    case 'higher':
      return `é maior que ${of(after)}, que é depois; não foi importada`
    case 'same-date':
      return 'o app já tem uma leitura nesse dia'
  }
}

/**
 * Brings in the readings of a spreadsheet like the other imports: only the
 * days the app has no reading for, when they fit among its readings.
 */
export function importTankSheet(
  db: Executor,
  sheet: TankSheet,
  today: string,
): TankImportResult {
  const result: TankImportResult = {
    added: 0,
    existing: 0,
    skipped: [...sheet.unreadable],
  }
  const byDate = (a: { date: string }, b: { date: string }) =>
    a.date.localeCompare(b.date)
  db.transaction((tx) => {
    const points = listTankReadings(tx)
    const seen = new Set<string>()
    for (const reading of [...sheet.readings].sort(byDate)) {
      const label = `Leitura de ${formatDate(reading.date)} (${formatTankReading(reading.liters)} m³)`
      if (seen.has(reading.date)) {
        result.skipped.push(
          `${label}: a planilha tem outra leitura nesse dia; ficou a primeira`,
        )
        continue
      }
      seen.add(reading.date)
      if (points.some((point) => point.date === reading.date)) {
        result.existing++
        continue
      }
      const { issue, before, after } = checkTankReading(points, reading, today)
      if (issue) {
        result.skipped.push(`${label}: ${reason(issue, before, after)}`)
        continue
      }
      const { id } = tx
        .insert(tankReadings)
        .values({ date: reading.date, readingLiters: reading.liters })
        .returning({ id: tankReadings.id })
        .get()
      points.push({ id, ...reading, meterReplaced: false })
      points.sort(byDate)
      result.added++
    }
    syncReplacedMeters(tx)
  })
  return result
}
