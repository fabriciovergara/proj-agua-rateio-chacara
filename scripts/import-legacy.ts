/**
 * Imports the data of the original Microsoft Access app (Kw.mdb), exported
 * as CSV (T_Usuarios.csv, T_Fatura.csv, T_Consumo.csv — e.g. with
 * `mdb-export Kw.mdb T_Usuarios > T_Usuarios.csv` from mdbtools).
 *
 *   bun run db:import-legacy <folder-with-csvs>           # empty database
 *   bun run db:import-legacy <folder-with-csvs> --reset   # wipes data first
 *
 * Each old "usuário" becomes a proprietário and a chácara; each row of
 * T_Cosumo becomes a monthly reading, keeping the kWh price and reserve fund
 * it was billed with.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import Papa from 'papaparse'
import { getDb } from '#/db/client.server'
import {
  bankAccount,
  monthRates,
  owners,
  properties,
  readings,
  settings,
} from '#/db/schema'
import { formatPeriod, periodKey } from '#/lib/periods'
import {
  legacyMoneyToCents,
  legacyPriceToMicros,
  legacyPropertyName,
  parseLegacyDate,
  parseLegacyPeriod,
} from './legacy'

type Row = Record<string, string>

const folder = process.argv[2]
const reset = process.argv.includes('--reset')

if (!folder || folder.startsWith('--')) {
  console.error(
    'Informe a pasta com os CSVs: bun run db:import-legacy ./legacy [--reset]',
  )
  process.exit(1)
}

function readCsv(name: string): Row[] {
  const file = path.join(folder as string, name)
  if (!existsSync(file)) {
    console.error(`Arquivo não encontrado: ${file}`)
    process.exit(1)
  }
  const parsed = Papa.parse<Row>(readFileSync(file, 'utf8'), {
    header: true,
    skipEmptyLines: true,
  })
  return parsed.data
}

const users = readCsv('T_Usuarios.csv')
const invoices = readCsv('T_Fatura.csv')
const consumption = readCsv('T_Consumo.csv')

const db = getDb()
const hasData = db.select({ id: properties.id }).from(properties).limit(1).get()
if (hasData && !reset) {
  console.error(
    'O banco já tem dados. Use --reset para apagar tudo antes de importar.',
  )
  process.exit(1)
}

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

console.log(
  `Importados ${users.length} proprietários/chácaras e ${imported} leituras.`,
)
if (skipped.length > 0) {
  console.log(`${skipped.length} registros não importados:`)
  for (const line of skipped) console.log(`  - ${line}`)
}
