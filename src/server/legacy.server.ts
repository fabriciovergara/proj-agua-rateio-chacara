/*
 * The data of the original Microsoft Access app (Kw.mdb, later Agua.mdb:
 * tables T_Usuarios, T_Fatura and T_Cosumo), read straight from the .mdb or
 * from its tables exported as CSV, e.g. with mdbtools:
 *
 *   mdb-export Kw.mdb T_Usuarios > T_Usuarios.csv
 *   mdb-export Kw.mdb T_Fatura   > T_Fatura.csv
 *   mdb-export Kw.mdb T_Cosumo   > T_Consumo.csv
 *
 * Imported from Configurações (the .mdb, or a .zip with it or with the CSVs)
 * or with `bun run db:import-legacy`; never on its own, so data wiped in
 * Configurações stays wiped.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import MDBReader, { type ColumnType, type Value } from 'mdb-reader'
import Papa from 'papaparse'
import type { Executor } from '#/db/client.server'
import { owners, type Period, periods, properties, readings } from '#/db/schema'
import { UserFacingError } from '#/lib/errors'
import {
  addMonthsToDate,
  type DateRange,
  formatDateRange,
  isISODate,
  rangesOverlap,
  yearOf,
} from '#/lib/periods'
import { deleteAllData } from './data.server'

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

const pad = (value: number) => String(value).padStart(2, '0')

/** A day of a month, moved into the month when it doesn't exist (31/02). */
function dateOf(year: number, month: number, day: number): string {
  for (let candidate = day; candidate > 0; candidate--) {
    const iso = `${year}-${pad(month)}-${pad(candidate)}`
    if (isISODate(iso)) return iso
  }
  return `${year}-${pad(month)}-01`
}

/** "07" → 2007, "2010" → 2010; a typo ("1", "2525", "9/10") → null. */
function legacyYear(text = ''): number | null {
  const year =
    text.length === 2
      ? 2000 + Number(text)
      : text.length === 4
        ? Number(text)
        : Number.NaN
  return year >= 2000 && year < 2100 ? year : null
}

/**
 * A date as the old app's users typed it: "10/10/09", "5/4/2012", "08 02 10"
 * (the typos "18//7/17", "17/9*\/25" and a slash typed as a digit or left out,
 * "10/04021", "06/922", included), or with the month's name: "10 Jan",
 * "10 Fev 2007", "Mar 08", "10 abril 09".
 */
const LEGACY_DATE = new RegExp(
  [
    String.raw`(?<!\d)(?<day>3[01]|[12]\d|0?[1-9])[^\p{L}\d]+(?<month>1[0-2]|0?[1-9])(?:[^\p{L}\d]+|(?=\d)|\d)(?<year>\d{4}|\d{2}|\d)(?!\d)`,
    String.raw`(?<!\d)(?:(?<nameDay>\d{1,2})\s*)?(?<!\p{L})(?<name>jan|fev|mar|abr|mai|jun|jul|lul|ago|set|out|nov|dez)\p{L}*\.?\s*(?<nameYear>\d{4}|\d{2})?(?!\d)`,
  ].join('|'),
  'giu',
)

type LegacyDay = { day: number; month: number; year: number | null }

/** The first two dates of the text: the start and the end of a period. */
function legacyDays(text: string): LegacyDay[] {
  return [...text.matchAll(LEGACY_DATE)].slice(0, 2).map(({ groups = {} }) =>
    groups.name
      ? {
          // A missing day is the 10th, when the meters were read.
          day: Number(groups.nameDay ?? 10) || 10,
          month: MONTHS[groups.name.toLowerCase()] ?? 1,
          year: legacyYear(groups.nameYear),
        }
      : {
          day: Number(groups.day),
          month: Number(groups.month),
          year: legacyYear(groups.year),
        },
  )
}

/** A chácara is read every few months: two years between readings is a typo. */
const plausible = ({ startDate, endDate }: DateRange) =>
  startDate < endDate && endDate <= addMonthsToDate(startDate, 24)

const withYear = (iso: string, year: number) =>
  dateOf(year, Number(iso.slice(5, 7)), Number(iso.slice(8, 10)))

const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000

/**
 * Readings that ended up to 15 days apart are the same round of readings:
 * the meters of a round were read within about a week, and rounds were at
 * least three weeks apart (monthly ones ended on 01/12/2010 and 31/12/2010).
 */
const sameRound = (endDate: string, otherEndDate: string) =>
  daysApart(endDate, otherEndDate) <= 15

/**
 * Both dates have a year, but not both can be right ("21/7/14 a 21/10/47",
 * "08 Fev 19 a 30 Set 10"): one takes the other's year. The end that lands
 * closer to the day the row was entered wins (without it, the start's year).
 */
function fixYearTypo(
  { startDate, endDate }: DateRange,
  enteredOn: string | null,
): DateRange | undefined {
  let end = withYear(endDate, yearOf(startDate))
  if (end <= startDate) end = withYear(endDate, yearOf(startDate) + 1)
  let start = withYear(startDate, yearOf(endDate))
  if (start >= endDate) start = withYear(startDate, yearOf(endDate) - 1)
  const fixes = [
    { startDate, endDate: end },
    { startDate: start, endDate },
  ].filter(plausible)
  if (!enteredOn) return fixes[0]
  return fixes.sort(
    (a, b) => daysApart(a.endDate, enteredOn) - daysApart(b.endDate, enteredOn),
  )[0]
}

/**
 * The old "Mes" column holds the reading period: "10 Jan/10 Fev 2007" and
 * "10 Nov 07 / 10 Jan 08" in the first years, then "10/10/09 a 08/02/10" or
 * "05/4/12 a 02/6/12". A year that is missing or mistyped comes from the
 * other date (the end is after the start), else from `fallbackYear`; a
 * missing day is the 10th, when the meters were read; a missing start is a
 * month earlier. `enteredOn`, the day the row was entered, tells which of
 * two conflicting years is the typo.
 */
export function parseLegacyPeriod(
  mes: string,
  fallbackYear: number | null,
  enteredOn: string | null = null,
): DateRange | null {
  const [first, second] = legacyDays(mes)
  const end = second ?? first
  const start = second ? first : undefined
  if (!end) return null

  const lastYearInText = [...mes.matchAll(/(?<!\d)\d{4}(?!\d)/g)]
    .map(([year]) => legacyYear(year))
    .findLast((year) => year !== null)
  const endYear =
    end.year ??
    (start?.year ? start.year + (end.month < start.month ? 1 : 0) : null) ??
    lastYearInText ??
    fallbackYear
  if (!endYear) return null
  const endDate = dateOf(endYear, end.month, end.day)
  if (!start) return { startDate: addMonthsToDate(endDate, -1), endDate }

  const startYear =
    start.year ?? (start.month > end.month ? endYear - 1 : endYear)
  const range = {
    startDate: dateOf(startYear, start.month, start.day),
    endDate,
  }
  if (plausible(range)) return range
  if (start.year && end.year) {
    const fixed = fixYearTypo(range, enteredOn)
    if (fixed) return fixed
  }
  return range.startDate < endDate
    ? range
    : { startDate: addMonthsToDate(endDate, -1), endDate }
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

/**
 * What the old app charged for energy: m³ × its price per m³, rounded half
 * up to the centavo.
 */
export function legacyEnergyCents(consumption: number, priceMicros: number) {
  return Math.floor((Math.max(consumption, 0) * priceMicros + 5_000) / 10_000)
}

/** "10" → 1000 centavos. */
export function legacyMoneyToCents(value: string): number {
  return Math.round(Number(value) * 100)
}

/**
 * The old app kept the chácara in the address column: "Chácara 29",
 * "(27)", "28) Recanto". Longer numbers are phones or CEPs. When
 * there is no number, the owner's name identifies it.
 */
export function legacyPropertyName(address: string, ownerName: string): string {
  const number = address.match(/(?<!\d)\d{1,3}(?!\d)/)?.[0]
  return number ? `Chácara ${Number(number)}` : `Chácara ${ownerName.trim()}`
}

type Row = Record<string, string>

/** The three tables, one object per CSV row keyed by column name. */
export type LegacyExport = {
  users: Row[]
  invoices: Row[]
  consumption: Row[]
  /** The Access database it came from, when a .zip had more than one. */
  database?: string
  /** The other Access databases of that .zip, left out as older copies. */
  olderCopies?: string[]
}

/**
 * The tables (in the .mdb and as CSV files) and the columns the import needs
 * from each. The consumption table is called T_Cosumo in Kw.mdb, so that
 * name works too.
 */
const TABLES = {
  users: {
    tables: ['T_Usuarios'],
    files: ['T_Usuarios.csv'],
    columns: ['CodigoUsr', 'Usuario'],
  },
  invoices: {
    tables: ['T_Fatura'],
    files: ['T_Fatura.csv'],
    columns: ['NumeroFatura', 'CodigoUsr'],
  },
  consumption: {
    tables: ['T_Cosumo', 'T_Consumo'],
    files: ['T_Consumo.csv', 'T_Cosumo.csv'],
    columns: ['NumeroFatura', 'LeituraAtual', 'LeituraAnterior', 'Mes'],
  },
} as const

type Table = keyof typeof TABLES

/** The real CSVs have a few KB; anything this big is not one of them. */
const MAX_CSV_BYTES = 20 * 1024 * 1024
/** The real Access databases have about 1 MB. */
const MAX_DATABASE_BYTES = 50 * 1024 * 1024

export function parseLegacyCsv(text: string): Row[] {
  return Papa.parse<Row>(text, { header: true, skipEmptyLines: true }).data
}

/** Refuses a table without the columns the import needs. */
function requireColumns(
  table: Table,
  columns: readonly string[] | undefined,
  label: string,
) {
  const missing = TABLES[table].columns.filter(
    (column) => !columns?.includes(column),
  )
  if (missing.length > 0) {
    throw new UserFacingError(
      `${label} não é do sistema antigo: faltam as colunas ${missing.join(', ')}.`,
    )
  }
}

/** Parses one table, refusing a file without the columns it needs. */
function parseTable(table: Table, text: string): Row[] {
  const { data, meta } = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
  })
  requireColumns(table, meta.fields, TABLES[table].files[0])
  return data
}

/** mdb-export writes UTF-8; programs on Windows often write Windows-1252. */
function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

function toLegacyExport(read: (table: Table) => Row[]): LegacyExport {
  return {
    users: read('users'),
    invoices: read('invoices'),
    consumption: read('consumption'),
  }
}

function csvTables(read: (table: Table) => Uint8Array): LegacyExport {
  return toLegacyExport((table) => parseTable(table, decodeCsv(read(table))))
}

/** Reads T_Usuarios.csv, T_Fatura.csv and T_Consumo.csv from `folder`. */
export function readLegacyExport(folder: string): LegacyExport {
  return csvTables((table) => {
    const files = TABLES[table].files.map((name) => path.join(folder, name))
    const file = files.find((candidate) => existsSync(candidate))
    if (!file) throw new Error(`Arquivo não encontrado: ${files[0]}`)
    return readFileSync(file)
  })
}

/** Access databases (.mdb, .accdb) have one of these after 4 bytes. */
const ACCESS_SIGNATURES = ['Standard Jet DB', 'Standard ACE DB']

export function isAccessFile(bytes: Uint8Array): boolean {
  const signature = new TextDecoder().decode(bytes.subarray(4, 19))
  return ACCESS_SIGNATURES.includes(signature)
}

/**
 * A value of an Access table as mdb-export writes it, so the .mdb gives the
 * same rows as its CSVs: dates month first ("02/15/07 00:00:00"), yes/no as
 * 1/0 and Single numbers with 8 digits ("0.34999999").
 */
function exportedValue(value: Value, type: ColumnType | undefined): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof Date) {
    // Access dates have no time zone: mdb-reader reads them as UTC.
    return `${pad(value.getUTCMonth() + 1)}/${pad(value.getUTCDate())}/${pad(value.getUTCFullYear() % 100)} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
  }
  if (typeof value === 'number' && type === 'float') {
    return String(Number(value.toPrecision(8)))
  }
  return String(value)
}

/**
 * The three tables straight from the old app's Access database. `name` is
 * the file's, for the messages.
 */
export function readLegacyMdb(bytes: Uint8Array, name?: string): LegacyExport {
  try {
    const reader = new MDBReader(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    )
    const inFile = new Map(
      reader.getTableNames().map((table) => [table.toLowerCase(), table]),
    )
    return toLegacyExport((table) => {
      const found = TABLES[table].tables
        .map((candidate) => inFile.get(candidate.toLowerCase()))
        .find(Boolean)
      if (!found) {
        throw new UserFacingError(
          `${name ?? 'O arquivo do Access'} não tem a tabela ${TABLES[table].tables[0]} do sistema antigo.`,
        )
      }
      const source = reader.getTable(found)
      const columns = source.getColumns()
      requireColumns(
        table,
        columns.map((column) => column.name),
        `A tabela ${found}`,
      )
      const types = new Map(columns.map((column) => [column.name, column.type]))
      return source.getData().map((row) => {
        const values: Row = {}
        for (const [column, value] of Object.entries(row)) {
          values[column] = exportedValue(value, types.get(column))
        }
        return values
      })
    })
  } catch (error) {
    if (error instanceof UserFacingError) throw error
    throw new UserFacingError(
      `Não foi possível ler ${name ?? 'o arquivo do Access'}.`,
    )
  }
}

/** The day of the export's most recent reading ("" when none has one). */
function lastReadingDay({ consumption }: LegacyExport): string {
  let last = ''
  for (const row of consumption) {
    const day = parseLegacyDate(row.Data) ?? ''
    if (day > last) last = day
  }
  return last
}

/**
 * Of several Access databases (Agua.mdb next to an old copy, Kw a.mdb), the
 * one with the most recent readings. Files that aren't one are left aside.
 */
function newestDatabase(files: [name: string, bytes: Uint8Array][]) {
  const read: { name: string; data: LegacyExport }[] = []
  let failure: unknown
  for (const [name, bytes] of files) {
    try {
      read.push({ name, data: readLegacyMdb(bytes, name) })
    } catch (error) {
      failure ??= error
    }
  }
  read.sort(
    (a, b) =>
      lastReadingDay(b.data).localeCompare(lastReadingDay(a.data)) ||
      b.data.consumption.length - a.data.consumption.length,
  )
  const [newest, ...older] = read
  if (!newest) throw failure
  if (older.length === 0) return newest.data
  return {
    ...newest.data,
    database: newest.name,
    olderCopies: older.map(({ name }) => name),
  }
}

const baseName = (name: string) => name.split(/[\\/]/).at(-1) ?? name

/** Copies of files that macOS adds to the .zip ("__MACOSX/._Kw.mdb"). */
const isMacJunk = (name: string) =>
  name.startsWith('__MACOSX/') || baseName(name).startsWith('._')

/**
 * The CSVs inside a .zip, in any of its folders, or else the Access
 * database (.mdb or .accdb); of several, the one with the most recent
 * readings. Other files (schema.sql, Agua.ldb…) are not even unpacked.
 */
export function readLegacyZip(bytes: Uint8Array): LegacyExport {
  const tableOf = new Map<string, Table>()
  for (const [table, { files }] of Object.entries(TABLES)) {
    for (const file of files) tableOf.set(file.toLowerCase(), table as Table)
  }
  const entryOf = new Map<Table, string>()
  const databases: string[] = []
  const tooBig: string[] = []
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: ({ name, originalSize }) => {
        if (isMacJunk(name)) return false
        const table = tableOf.get(baseName(name).toLowerCase())
        const isDatabase = /\.(mdb|accdb)$/i.test(name)
        if (table ? entryOf.has(table) : !isDatabase) return false
        if (originalSize > (table ? MAX_CSV_BYTES : MAX_DATABASE_BYTES)) {
          tooBig.push(baseName(name))
          return false
        }
        if (table) entryOf.set(table, name)
        else databases.push(name)
        return true
      },
    })
  } catch {
    throw new UserFacingError(
      'Não foi possível abrir o arquivo. Envie o .zip com os dados do sistema antigo.',
    )
  }
  if (tooBig.length > 0) {
    throw new UserFacingError(`${tooBig[0]} é grande demais.`)
  }
  if (entryOf.size < Object.keys(TABLES).length && databases.length > 0) {
    return newestDatabase(
      databases.map((name) => [
        baseName(name),
        files[name] ?? new Uint8Array(),
      ]),
    )
  }
  if (entryOf.size === 0) {
    throw new UserFacingError(
      'O .zip não tem os dados do sistema antigo: o arquivo do Access (.mdb) ou T_Usuarios.csv, T_Fatura.csv e T_Consumo.csv.',
    )
  }
  return csvTables((table) => {
    const entry = entryOf.get(table)
    const file = entry === undefined ? undefined : files[entry]
    if (!file) {
      throw new UserFacingError(
        `O .zip não tem o arquivo ${TABLES[table].files[0]}.`,
      )
    }
    return file
  })
}

/**
 * The script's argument: a folder with the CSVs, the .zip or the Access
 * database itself.
 */
export function readLegacyPath(target: string): LegacyExport {
  if (statSync(target).isDirectory()) return readLegacyExport(target)
  const bytes = readFileSync(target)
  return isAccessFile(bytes)
    ? readLegacyMdb(bytes, path.basename(target))
    : readLegacyZip(bytes)
}

/** "Chácara  7" and "chacara 7" are the same chácara. */
export function comparable(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const meterKey = (value: string | null | undefined) =>
  comparable(value).replace(/[^a-z0-9]/g, '')

/** Left on each imported owner; it also tells their code in the old app. */
const importedNote = (code: string) =>
  `Importado do sistema antigo (código ${code}).`
const IMPORTED_CODE = /Importado do sistema antigo \(código (\d+)\)/

/** A chácara already in the app. */
export type Place = { id: number; name: string }

/**
 * The chácaras already in the app, to recognize an imported one: by its
 * owner's code in the old app (when given), else by name, else by meter.
 * More than one result means the app can't tell which one it is.
 */
export function chacarasInApp(db: Executor) {
  const byCode = new Map<string, Place>()
  const byName = new Map<string, Place[]>()
  const byMeter = new Map<string, Place[]>()
  const index = (map: Map<string, Place[]>, key: string, place: Place) => {
    if (key) map.set(key, [...(map.get(key) ?? []), place])
  }
  const inApp = db
    .select({
      id: properties.id,
      name: properties.name,
      meter: properties.meterNumber,
      ownerNotes: owners.notes,
    })
    .from(properties)
    .leftJoin(owners, eq(owners.id, properties.ownerId))
    .all()
  for (const { id, name, meter, ownerNotes } of inApp) {
    const code = ownerNotes?.match(IMPORTED_CODE)?.[1]
    if (code && !byCode.has(code)) byCode.set(code, { id, name })
    index(byName, comparable(name), { id, name })
    index(byMeter, meterKey(meter), { id, name })
  }

  return (chacara: {
    code?: string
    name: string
    meter: string | null | undefined
  }): Place[] => {
    const known = chacara.code ? byCode.get(chacara.code) : undefined
    if (known) return [known]
    return (
      byName.get(comparable(chacara.name)) ??
      byMeter.get(meterKey(chacara.meter)) ??
      []
    )
  }
}

/** Identifies a chácara's period in `readingsInApp`. */
export const chacaraPeriod = (propertyId: number, periodId: number) =>
  `${propertyId}:${periodId}`

/** The periods each chácara already has a reading in. */
export function readingsInApp(db: Executor): Set<string> {
  return new Set(
    db
      .select({ propertyId: readings.propertyId, periodId: readings.periodId })
      .from(readings)
      .all()
      .map((reading) => chacaraPeriod(reading.propertyId, reading.periodId)),
  )
}

/** The value most rows have (ties: the largest). */
function mostCommon<T extends string | number>(values: T[]): T | undefined {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0),
  )[0]?.[0]
}

export type LegacyImportResult = {
  /** Old users that became a new owner and chácara. */
  created: number
  /** Chácaras of old users that were already in the app. */
  matched: number
  /** Readings added. */
  readings: number
  /** Readings left out because the app already has that period. */
  existing: number
  /** Rows that couldn't be imported, with the reason. */
  skipped: string[]
}

/** A row of T_Cosumo ready to become a reading. */
type LegacyReading = {
  label: string
  property: Place
  range: DateRange
  previousReading: number
  currentReading: number
  energyCents: number
  reserveFundCents: number
  paid: boolean
  notes: string
}

/**
 * Brings the old app's data in without changing what is already there, so
 * it can run again, also after periods typed in the new app. An old user
 * whose chácara is in the app (imported before, or with the same name or
 * meter) keeps it; the others become a proprietário and a chácara, one per
 * meter (an old user registered again with the same meter is the same
 * chácara).
 *
 * The rows of T_Cosumo are grouped by the round of readings they belong to
 * (periods ending up to 15 days apart): each round is a period (the dates
 * most of them have, starting no earlier than the period before ends) whose
 * electricity bill is what the old app charged for energy. A chácara read on
 * other dates keeps them; one with two rows in a round keeps the last one
 * entered, the correction. A period of the app ending in the same round gets
 * the readings the chácaras lack there. Every reading keeps what it was
 * charged. `reset` first deletes all the data (not the password).
 */
export function importLegacy(
  db: Executor,
  { users, invoices, consumption }: LegacyExport,
  { reset = false } = {},
): LegacyImportResult {
  const clean = (value: string | undefined) => value?.trim() || null
  const skipped: string[] = []
  let created = 0
  const matched = new Set<number>()
  let imported = 0
  let existing = 0

  db.transaction((tx) => {
    if (reset) deleteAllData(tx)

    const findInApp = chacarasInApp(tx)
    // Chácaras created by this import, by meter: an old user registered
    // again with the same meter is the same chácara.
    const createdByMeter = new Map<string, Place>()

    // Old user code → chácara
    const propertyByUser = new Map<string, Place>()
    // Users left out: one line explains it, not one per reading.
    const leftOut = new Set<string>()
    const byCode = [...users].sort(
      (a, b) => Number(a.CodigoUsr) - Number(b.CodigoUsr) || 0,
    )
    for (const user of byCode) {
      const code = String(user.CodigoUsr)
      const name = clean(user.Usuario) ?? `Usuário ${code}`
      const propertyName = legacyPropertyName(user.Endereco ?? '', name)
      const candidates = findInApp({
        code,
        name: propertyName,
        meter: user.Hidrometro,
      })
      if (candidates.length > 1) {
        skipped.push(
          `${propertyName} (código ${code}): o app tem mais de uma chácara com esse nome ou hidrômetro; as leituras dela não foram importadas`,
        )
        leftOut.add(code)
        continue
      }
      const [found] = candidates
      if (found) {
        propertyByUser.set(code, found)
        matched.add(found.id)
        continue
      }
      const again = createdByMeter.get(meterKey(user.Hidrometro))
      if (again) {
        propertyByUser.set(code, again)
        continue
      }

      const owner = tx
        .insert(owners)
        .values({
          name,
          document: clean(user.CPF),
          phone: clean(user.Celular) ?? clean(user.Telefone),
          notes: [clean(user.Observacoes), importedNote(code)]
            .filter(Boolean)
            .join('\n'),
        })
        .returning()
        .get()
      const property = tx
        .insert(properties)
        .values({
          name: propertyName,
          ownerId: owner.id,
          meterNumber: clean(user.Hidrometro),
          notes: user.Endereco
            ? `Endereço no sistema antigo: ${user.Endereco.trim()}`
            : null,
        })
        .returning()
        .get()
      propertyByUser.set(code, property)
      const meter = meterKey(user.Hidrometro)
      if (meter) createdByMeter.set(meter, property)
      created++
    }

    // Old invoice number → user code
    const userByInvoice = new Map(
      invoices.map((invoice) => [
        String(invoice.NumeroFatura),
        String(invoice.CodigoUsr),
      ]),
    )

    // The rows that can become readings, in the order they were entered.
    const rowsInOrder = [...consumption].sort(
      (a, b) => Number(a.CodigoCosumo) - Number(b.CodigoCosumo) || 0,
    )
    const valid: LegacyReading[] = []
    for (const row of rowsInOrder) {
      const label = `registro ${row.CodigoCosumo}`
      const userCode = userByInvoice.get(String(row.NumeroFatura))
      if (userCode !== undefined && leftOut.has(userCode)) continue
      if (!row.LeituraAtual || !row.LeituraAnterior) {
        skipped.push(`${label}: sem leitura`)
        continue
      }
      const property = propertyByUser.get(userCode ?? '')
      if (!property) {
        skipped.push(`${label}: fatura ${row.NumeroFatura} sem usuário`)
        continue
      }
      const enteredOn = parseLegacyDate(row.Data)
      const range = parseLegacyPeriod(
        row.Mes ?? '',
        legacyYear(row.Ano?.trim()) ?? (enteredOn ? yearOf(enteredOn) : null),
        enteredOn,
      )
      if (!range) {
        skipped.push(`${label}: período "${row.Mes}" não reconhecido`)
        continue
      }
      const previousReading = Number(row.LeituraAnterior)
      const currentReading = Number(row.LeituraAtual)
      if (currentReading < previousReading) {
        skipped.push(`${label}: leitura atual menor que a anterior`)
        continue
      }
      valid.push({
        label,
        property,
        range,
        previousReading,
        currentReading,
        energyCents: legacyEnergyCents(
          currentReading - previousReading,
          legacyPriceToMicros(row.Valor ?? '0'),
        ),
        reserveFundCents: legacyMoneyToCents(row.Fundo ?? '0'),
        paid: row.Quitado === '1',
        notes: [
          `Período no sistema antigo: ${row.Mes?.trim()}`,
          row.Vencimento?.trim() && `vencimento ${row.Vencimento.trim()}`,
        ]
          .filter(Boolean)
          .join(', '),
      })
    }

    // Periods: rows ending a few days apart were read in the same round, in
    // which each chácara is read once; read again later, it is the next one.
    const groups: LegacyReading[][] = []
    const byEnd = [...valid].sort((a, b) =>
      a.range.endDate.localeCompare(b.range.endDate),
    )
    for (const row of byEnd) {
      const group = groups.at(-1)
      const last = group?.at(-1)?.range.endDate
      const sameGroup =
        group &&
        last &&
        sameRound(last, row.range.endDate) &&
        group.every(
          (other) =>
            other.property.id !== row.property.id ||
            sameRound(other.range.endDate, row.range.endDate),
        )
      if (sameGroup) group.push(row)
      else groups.push([row])
    }

    // Periods each chácara already has a reading in: those stay as they are.
    const taken = readingsInApp(tx)
    // The app's periods before the import, and with the ones it creates.
    const inApp: Period[] = tx.select().from(periods).all()
    const appPeriods = [...inApp]
    let previousEnd: string | null = null

    for (const group of groups) {
      // One reading per chácara: a row entered again (a correction) replaces
      // the one before it.
      const latest = new Map<number, LegacyReading>()
      for (const row of group) {
        const before = latest.get(row.property.id)
        if (before) {
          skipped.push(
            `${before.label}: ${row.property.name} tem outra leitura no período de ${formatDateRange(row.range)} (entrou a mais recente, ${row.label})`,
          )
        }
        latest.set(row.property.id, row)
      }
      const rows = [...latest.values()]
      const endDate =
        mostCommon(rows.map((row) => row.range.endDate)) ??
        rows[0]?.range.endDate
      const commonStart =
        mostCommon(rows.map((row) => row.range.startDate)) ??
        rows[0]?.range.startDate
      if (!endDate || !commonStart) continue
      let startDate: string =
        previousEnd && previousEnd > commonStart ? previousEnd : commonStart
      if (startDate >= endDate) startDate = addMonthsToDate(endDate, -1)

      // A period of the app ending in the same round is this one (the closest
      // to it, when there are two).
      const away = (other: Period) => daysApart(other.endDate, endDate)
      const [closest, next] = inApp
        .filter((other) => sameRound(other.endDate, endDate))
        .sort((a, b) => away(a) - away(b))
      let period: Period | undefined
      if (closest && next && away(closest) === away(next)) {
        skipped.push(
          `${rows.length} leituras de ${formatDateRange({ startDate, endDate })}: o app tem mais de um período terminando nessa época; elas não foram importadas`,
        )
        continue
      }
      if (closest) {
        period = closest
      } else {
        const range: DateRange = { startDate, endDate }
        const clash = appPeriods.find((other) => rangesOverlap(other, range))
        if (clash) {
          skipped.push(
            `${rows.length} leituras de ${formatDateRange(range)}: o app tem o período de ${formatDateRange(clash)} nessas datas; elas não foram importadas`,
          )
          continue
        }
        period = tx
          .insert(periods)
          .values({
            ...range,
            energyBillCents: rows.reduce(
              (sum, row) => sum + row.energyCents,
              0,
            ),
            reserveFundCents:
              mostCommon(rows.map((row) => row.reserveFundCents)) ?? 0,
          })
          .returning()
          .get()
        appPeriods.push(period)
      }
      previousEnd = period.endDate

      for (const row of rows) {
        const key = chacaraPeriod(row.property.id, period.id)
        if (taken.has(key)) {
          existing++
          continue
        }
        taken.add(key)
        tx.insert(readings)
          .values({
            propertyId: row.property.id,
            periodId: period.id,
            previousReading: row.previousReading,
            currentReading: row.currentReading,
            startDate:
              row.range.startDate === period.startDate
                ? null
                : row.range.startDate,
            endDate:
              row.range.endDate === period.endDate ? null : row.range.endDate,
            energyCents: row.energyCents,
            reserveFundCents: row.reserveFundCents,
            paid: row.paid,
            notes: row.notes,
          })
          .run()
        imported++
      }
    }
  })

  return {
    created,
    matched: matched.size,
    readings: imported,
    existing,
    skipped,
  }
}

/** The import's outcome as printed by the script. */
export function describeLegacyImport({
  created,
  matched,
  readings,
  existing,
  skipped,
}: LegacyImportResult): string {
  const lines = [
    `Importados ${created} proprietários/chácaras e ${readings} leituras.`,
  ]
  if (matched > 0 || existing > 0) {
    lines.push(
      `Já estavam no app, sem mudanças: ${matched} chácaras e ${existing} leituras.`,
    )
  }
  if (skipped.length > 0) {
    lines.push(`${skipped.length} registros não importados:`)
    for (const line of skipped) lines.push(`  - ${line}`)
  }
  return lines.join('\n')
}
