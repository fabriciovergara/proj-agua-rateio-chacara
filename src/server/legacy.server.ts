/*
 * The data of the original Microsoft Access app (Kw.mdb: tables T_Usuarios,
 * T_Fatura and T_Cosumo), exported as CSV, e.g. with mdbtools:
 *
 *   mdb-export Kw.mdb T_Usuarios > T_Usuarios.csv
 *   mdb-export Kw.mdb T_Fatura   > T_Fatura.csv
 *   mdb-export Kw.mdb T_Cosumo   > T_Consumo.csv
 *
 * Imported from a .zip in Configurações, with `bun run db:import-legacy`,
 * or when the app opens an empty database and LEGACY_DATA_PATH points at
 * the folder with these files.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import Papa from 'papaparse'
import type { Executor } from '#/db/client.server'
import { owners, type Period, periods, properties, readings } from '#/db/schema'
import { UserFacingError } from '#/lib/errors'
import {
  addMonthsToDate,
  type DateRange,
  formatDateRange,
  formatMonthYear,
  isISODate,
  rangesOverlap,
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

/**
 * The old "Mes" column holds the reading period, e.g. "10 Jan/10 Fev 2007"
 * or "10 Nov 07 / 10 Jan 08". The start's year, when missing, is the end's
 * (or the year before, for "10 Dez / 10 Jan 2009"); a missing day is the
 * 10th, when the meters were read; a missing start is a month earlier.
 */
export function parseLegacyPeriod(
  mes: string,
  fallbackYear: number | null,
): DateRange | null {
  const pattern =
    /(?:(\d{1,2})\s*)?(jan|fev|mar|abr|mai|jun|jul|lul|ago|set|out|nov|dez)[a-zç]*\.?\s*(\d{4}|\d{2}(?!\d))?/gi
  const dates = [...mes.matchAll(pattern)].flatMap((match) => {
    const month = MONTHS[match[2]?.toLowerCase() ?? '']
    if (!month) return []
    const year = match[3]
      ? match[3].length === 2
        ? 2000 + Number(match[3])
        : Number(match[3])
      : null
    return [{ day: Number(match[1] ?? 10) || 10, month, year }]
  })
  const end = dates.at(-1)
  if (!end) return null

  const endYear =
    end.year ?? (Number(mes.match(/\d{4}/g)?.at(-1)) || fallbackYear)
  if (!endYear) return null
  const endDate = dateOf(endYear, end.month, end.day)

  const start = dates.length > 1 ? dates[0] : undefined
  const startDate = start
    ? dateOf(
        start.year ?? (start.month > end.month ? endYear - 1 : endYear),
        start.month,
        start.day,
      )
    : null
  return {
    startDate:
      startDate && startDate < endDate
        ? startDate
        : addMonthsToDate(endDate, -1),
    endDate,
  }
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
 * "(27)", "28)". When there is no number, the owner's name identifies it.
 */
export function legacyPropertyName(address: string, ownerName: string): string {
  const number = address.match(/\d+/)?.[0]
  return number ? `Chácara ${Number(number)}` : `Chácara ${ownerName.trim()}`
}

type Row = Record<string, string>

/** The three tables, one object per CSV row keyed by column name. */
export type LegacyExport = {
  users: Row[]
  invoices: Row[]
  consumption: Row[]
}

/**
 * The files and the columns the import needs from each. The consumption
 * table is called T_Cosumo in Kw.mdb, so that file name works too.
 */
const TABLES = {
  users: { files: ['T_Usuarios.csv'], columns: ['CodigoUsr', 'Usuario'] },
  invoices: { files: ['T_Fatura.csv'], columns: ['NumeroFatura', 'CodigoUsr'] },
  consumption: {
    files: ['T_Consumo.csv', 'T_Cosumo.csv'],
    columns: ['NumeroFatura', 'LeituraAtual', 'LeituraAnterior', 'Mes'],
  },
} as const

type Table = keyof typeof TABLES

/** The real CSVs have a few KB; anything this big is not one of them. */
const MAX_CSV_BYTES = 20 * 1024 * 1024

export function parseLegacyCsv(text: string): Row[] {
  return Papa.parse<Row>(text, { header: true, skipEmptyLines: true }).data
}

/** Parses one table, refusing a file without the columns it needs. */
function parseTable(table: Table, text: string): Row[] {
  const { data, meta } = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: true,
  })
  const missing = TABLES[table].columns.filter(
    (column) => !meta.fields?.includes(column),
  )
  if (missing.length > 0) {
    throw new UserFacingError(
      `${TABLES[table].files[0]} não é do sistema antigo: faltam as colunas ${missing.join(', ')}.`,
    )
  }
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

function toLegacyExport(read: (table: Table) => Uint8Array): LegacyExport {
  const parse = (table: Table) => parseTable(table, decodeCsv(read(table)))
  return {
    users: parse('users'),
    invoices: parse('invoices'),
    consumption: parse('consumption'),
  }
}

/** Reads T_Usuarios.csv, T_Fatura.csv and T_Consumo.csv from `folder`. */
export function readLegacyExport(folder: string): LegacyExport {
  return toLegacyExport((table) => {
    const files = TABLES[table].files.map((name) => path.join(folder, name))
    const file = files.find((candidate) => existsSync(candidate))
    if (!file) throw new Error(`Arquivo não encontrado: ${files[0]}`)
    return readFileSync(file)
  })
}

const baseName = (name: string) => name.split(/[\\/]/).at(-1) ?? name

/**
 * The same CSVs inside a .zip, in any of its folders. Other files (Kw.mdb,
 * schema.sql…) are not even unpacked.
 */
export function readLegacyZip(bytes: Uint8Array): LegacyExport {
  const tableOf = new Map<string, Table>()
  for (const [table, { files }] of Object.entries(TABLES)) {
    for (const file of files) tableOf.set(file.toLowerCase(), table as Table)
  }
  const entryOf = new Map<Table, string>()
  const tooBig: string[] = []
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: ({ name, originalSize }) => {
        const table = tableOf.get(baseName(name).toLowerCase())
        if (!table || entryOf.has(table)) return false
        if (originalSize > MAX_CSV_BYTES) {
          tooBig.push(baseName(name))
          return false
        }
        entryOf.set(table, name)
        return true
      },
    })
  } catch {
    throw new UserFacingError(
      'Não foi possível abrir o arquivo. Envie o .zip com os CSVs do sistema antigo.',
    )
  }
  if (tooBig.length > 0) {
    throw new UserFacingError(`${tooBig[0]} é grande demais.`)
  }
  return toLegacyExport((table) => {
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

/** No owners and no chácaras yet (the password and settings don't count). */
export function isEmptyDatabase(db: Executor): boolean {
  return (
    !db.select({ id: owners.id }).from(owners).limit(1).get() &&
    !db.select({ id: properties.id }).from(properties).limit(1).get()
  )
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
  /** Old users whose chácara was already in the app. */
  matched: number
  /** Readings added. */
  readings: number
  /** Readings left out because the app already has that month. */
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
 * meter) keeps it; the others become a proprietário and a chácara.
 *
 * The rows of T_Cosumo are grouped by the month their period ends in: each
 * group is a period (the dates most of them have, starting no earlier than
 * the period before ends) whose electricity bill is what the old app charged
 * for energy. A chácara read on other dates keeps them. A period of the app
 * ending in that month gets the readings the chácaras lack there. Every
 * reading keeps what it was charged. `reset` first deletes all the data
 * (not the password).
 */
export function importLegacy(
  db: Executor,
  { users, invoices, consumption }: LegacyExport,
  { reset = false } = {},
): LegacyImportResult {
  const clean = (value: string | undefined) => value?.trim() || null
  const skipped: string[] = []
  let created = 0
  let matched = 0
  let imported = 0
  let existing = 0

  db.transaction((tx) => {
    if (reset) deleteAllData(tx)

    const findInApp = chacarasInApp(tx)

    // Old user code → chácara
    const propertyByUser = new Map<string, Place>()
    // Users left out: one line explains it, not one per reading.
    const leftOut = new Set<string>()
    for (const user of users) {
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
        matched++
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
      created++
    }

    // Old invoice number → user code
    const userByInvoice = new Map(
      invoices.map((invoice) => [
        String(invoice.NumeroFatura),
        String(invoice.CodigoUsr),
      ]),
    )

    // The rows, by the month their period ends in.
    const groups = new Map<string, LegacyReading[]>()
    const seen = new Map<string, string>()
    for (const row of consumption) {
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
      const readingDate = parseLegacyDate(row.Data)
      const range = parseLegacyPeriod(
        row.Mes ?? '',
        Number(row.Ano) || Number(readingDate?.slice(0, 4)) || null,
      )
      if (!range) {
        skipped.push(`${label}: período "${row.Mes}" não reconhecido`)
        continue
      }
      const month = range.endDate.slice(0, 7)
      const key = `${property.id}:${month}`
      const already = seen.get(key)
      if (already) {
        skipped.push(
          `${label}: ${property.name} já tem leitura no período de ${already}`,
        )
        continue
      }
      const previousReading = Number(row.LeituraAnterior)
      const currentReading = Number(row.LeituraAtual)
      if (currentReading < previousReading) {
        skipped.push(`${label}: leitura atual menor que a anterior`)
        continue
      }
      seen.set(key, formatDateRange(range))
      const group = groups.get(month) ?? []
      group.push({
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
      groups.set(month, group)
    }

    // Periods each chácara already has a reading in: those stay as they are.
    const taken = readingsInApp(tx)
    const appPeriods: Period[] = tx.select().from(periods).all()
    let previousEnd: string | null = null

    for (const [month, rows] of [...groups.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
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

      const sameMonth = appPeriods.filter(
        (period) => period.endDate.slice(0, 7) === month,
      )
      let period: Period | undefined
      if (sameMonth.length > 1) {
        skipped.push(
          `${rows.length} leituras de ${formatMonthYear(endDate)}: o app tem mais de um período terminando nesse mês; elas não foram importadas`,
        )
        continue
      }
      if (sameMonth[0]) {
        period = sameMonth[0]
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

  return { created, matched, readings: imported, existing, skipped }
}

/** The import's outcome as printed by the script and the server log. */
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

/**
 * LEGACY_DATA_PATH: a new server starts with the old app's history. Only an
 * empty database is filled, so once there is data (imported or typed in)
 * this does nothing, even with the files still there.
 */
export function prefillFromLegacy(db: Executor, folder: string) {
  if (!isEmptyDatabase(db)) return null
  const result = importLegacy(db, readLegacyExport(folder))
  console.log(
    `Banco vazio preenchido com os dados do sistema antigo (${folder}).\n` +
      describeLegacyImport(result),
  )
  return result
}
