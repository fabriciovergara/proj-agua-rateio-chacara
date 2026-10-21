/*
 * The data of the original Microsoft Access app (Kw.mdb: tables T_Usuarios,
 * T_Fatura and T_Cosumo), exported as CSV, e.g. with mdbtools:
 *
 *   mdb-export Kw.mdb T_Usuarios > T_Usuarios.csv
 *   mdb-export Kw.mdb T_Fatura   > T_Fatura.csv
 *   mdb-export Kw.mdb T_Cosumo   > T_Consumo.csv
 *
 * Imported with `bun run db:import-legacy`, or when the app opens an empty
 * database and LEGACY_DATA_PATH points at the folder with these files.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import type { Executor } from '#/db/client.server'
import {
  bankAccount,
  monthRates,
  owners,
  properties,
  readings,
  settings,
} from '#/db/schema'
import { formatPeriod, type Period, periodKey } from '#/lib/periods'

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

type Row = Record<string, string>

/** The three tables, one object per CSV row keyed by column name. */
export type LegacyExport = {
  users: Row[]
  invoices: Row[]
  consumption: Row[]
}

export function parseLegacyCsv(text: string): Row[] {
  return Papa.parse<Row>(text, { header: true, skipEmptyLines: true }).data
}

/** Reads T_Usuarios.csv, T_Fatura.csv and T_Consumo.csv from `folder`. */
export function readLegacyExport(folder: string): LegacyExport {
  const read = (name: string) => {
    const file = path.join(folder, name)
    if (!existsSync(file)) throw new Error(`Arquivo não encontrado: ${file}`)
    return parseLegacyCsv(readFileSync(file, 'utf8'))
  }
  return {
    users: read('T_Usuarios.csv'),
    invoices: read('T_Fatura.csv'),
    consumption: read('T_Consumo.csv'),
  }
}

/** No owners and no chácaras yet (the password and settings don't count). */
export function isEmptyDatabase(db: Executor): boolean {
  return (
    !db.select({ id: owners.id }).from(owners).limit(1).get() &&
    !db.select({ id: properties.id }).from(properties).limit(1).get()
  )
}

/**
 * Each old "usuário" becomes a proprietário and a chácara; each row of
 * T_Cosumo becomes a monthly reading, keeping the kWh price and reserve fund
 * it was billed with. `reset` first deletes all the data (not the password).
 */
export function importLegacy(
  db: Executor,
  { users, invoices, consumption }: LegacyExport,
  { reset = false } = {},
) {
  const clean = (value: string | undefined) => value?.trim() || null
  const skipped: string[] = []
  let imported = 0

  db.transaction((tx) => {
    if (reset) {
      tx.delete(readings).run()
      tx.delete(properties).run()
      tx.delete(owners).run()
      tx.delete(settings).run()
      tx.delete(monthRates).run()
      tx.delete(bankAccount).run()
    }

    // Old user code → new chácara id
    const propertyByUser = new Map<string, { id: number; name: string }>()
    for (const user of users) {
      const name = clean(user.Usuario) ?? `Usuário ${user.CodigoUsr}`
      const owner = tx
        .insert(owners)
        .values({
          name,
          document: clean(user.CPF),
          phone: clean(user.Celular) ?? clean(user.Telefone),
          notes: [
            clean(user.Observacoes),
            `Importado do sistema antigo (código ${user.CodigoUsr}).`,
          ]
            .filter(Boolean)
            .join('\n'),
        })
        .returning()
        .get()
      const property = tx
        .insert(properties)
        .values({
          name: legacyPropertyName(user.Endereco ?? '', name),
          ownerId: owner.id,
          meterNumber: clean(user.Hidrometro),
          notes: user.Endereco
            ? `Endereço no sistema antigo: ${user.Endereco.trim()}`
            : null,
        })
        .returning()
        .get()
      propertyByUser.set(String(user.CodigoUsr), property)
    }

    // Old invoice number → user code
    const userByInvoice = new Map(
      invoices.map((invoice) => [
        String(invoice.NumeroFatura),
        String(invoice.CodigoUsr),
      ]),
    )

    const seen = new Set<string>()
    // How many readings of each month used each price/fund pair.
    const ratesByMonth = new Map<string, Map<string, number>>()

    for (const row of consumption) {
      const label = `registro ${row.CodigoCosumo}`
      if (!row.LeituraAtual || !row.LeituraAnterior) {
        skipped.push(`${label}: sem leitura`)
        continue
      }
      const property = propertyByUser.get(
        userByInvoice.get(String(row.NumeroFatura)) ?? '',
      )
      if (!property) {
        skipped.push(`${label}: fatura ${row.NumeroFatura} sem usuário`)
        continue
      }
      const readingDate = parseLegacyDate(row.Data)
      const period = parseLegacyPeriod(
        row.Mes ?? '',
        Number(row.Ano) || Number(readingDate?.slice(0, 4)) || null,
      )
      if (!period) {
        skipped.push(`${label}: período "${row.Mes}" não reconhecido`)
        continue
      }
      const key = `${property.id}:${periodKey(period)}`
      if (seen.has(key)) {
        skipped.push(
          `${label}: ${property.name} já tem leitura de ${formatPeriod(period)}`,
        )
        continue
      }
      const previousReading = Number(row.LeituraAnterior)
      const currentReading = Number(row.LeituraAtual)
      if (currentReading < previousReading) {
        skipped.push(`${label}: leitura atual menor que a anterior`)
        continue
      }
      seen.add(key)

      const price = legacyPriceToMicros(row.Valor ?? '0')
      const fund = legacyMoneyToCents(row.Fundo ?? '0')
      tx.insert(readings)
        .values({
          propertyId: property.id,
          ...period,
          previousReading,
          currentReading,
          kwhPriceMicros: price,
          reserveFundCents: fund,
          paid: row.Quitado === '1',
          readingDate,
          notes: [
            `Período no sistema antigo: ${row.Mes?.trim()}`,
            row.Vencimento?.trim() && `vencimento ${row.Vencimento.trim()}`,
          ]
            .filter(Boolean)
            .join(', '),
        })
        .run()
      imported++

      const monthKey = periodKey(period)
      const counts = ratesByMonth.get(monthKey) ?? new Map<string, number>()
      const pair = `${price}:${fund}`
      counts.set(pair, (counts.get(pair) ?? 0) + 1)
      ratesByMonth.set(monthKey, counts)
    }

    // Each month's values are the ones most of its readings were billed with;
    // the next month typed in the new app starts from the last of them.
    for (const [monthKey, counts] of ratesByMonth) {
      const [year, month] = monthKey.split('-').map(Number)
      const [pair] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
      const [price, fund] = (pair ?? '').split(':').map(Number)
      if (!year || !month || price === undefined || fund === undefined) continue
      tx.insert(monthRates)
        .values({ year, month, kwhPriceMicros: price, reserveFundCents: fund })
        .onConflictDoNothing()
        .run()
    }
  })

  return { owners: users.length, readings: imported, skipped }
}

/** The import's outcome as printed by the script and the server log. */
export function describeLegacyImport({
  owners,
  readings,
  skipped,
}: ReturnType<typeof importLegacy>): string {
  const lines = [
    `Importados ${owners} proprietários/chácaras e ${readings} leituras.`,
  ]
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
