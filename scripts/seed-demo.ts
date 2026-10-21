/**
 * Fills the database with fictitious chácaras, owners and 18 months of
 * readings, so the app can be explored before real data is typed in.
 *
 *   bun run db:seed            # only on an empty database
 *   bun run db:seed --reset    # wipes everything first
 */
import { getDb } from '#/db/client.server'
import {
  bankAccount,
  monthRates,
  owners,
  properties,
  readings,
  settings,
} from '#/db/schema'
import { addMonths, currentPeriod, type Period } from '#/lib/periods'

const db = getDb()
const reset = process.argv.includes('--reset')

const hasData = db.select({ id: properties.id }).from(properties).limit(1).get()
if (hasData && !reset) {
  console.error(
    'O banco já tem dados. Use "bun run db:seed --reset" para apagar tudo e recriar.',
  )
  process.exit(1)
}

// Deterministic pseudo-random numbers: the same seed gives the same data.
let state = 20_260_901
function random() {
  state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
  return state / 2_147_483_648
}

const CHACARAS = [
  { name: 'Chácara 12', owner: 'Ana Paula Ribeiro', base: 38, start: 1180 },
  { name: 'Chácara 14', owner: 'Benedito Souza', base: 62, start: 4210 },
  { name: 'Chácara 15', owner: 'Carmem Lúcia Prado', base: 21, start: 860 },
  { name: 'Chácara 21', owner: 'Dirceu Almeida', base: 95, start: 10_420 },
  {
    name: 'Recanto das Palmeiras',
    owner: 'Elza Moreira',
    base: 44,
    start: 2675,
  },
  {
    name: 'Sítio Boa Vista',
    owner: 'Francisco Teixeira',
    base: 130,
    start: 15_890,
  },
  { name: 'Chácara 27', owner: 'Geraldo Pires', base: 12, start: 512 },
  { name: 'Chácara 30', owner: 'Helena Campos', base: 57, start: 3390 },
]

/** The pump works harder in the dry winter months (June–September). */
function seasonal(month: number) {
  return [1, 0.95, 0.9, 0.95, 1.05, 1.2, 1.3, 1.35, 1.25, 1.05, 0.95, 1][
    month - 1
  ] as number
}

function priceFor(period: Period) {
  return period.year >= 2026 ? 850_000 : 780_000
}

db.transaction((tx) => {
  if (reset) {
    tx.delete(readings).run()
    tx.delete(properties).run()
    tx.delete(owners).run()
    tx.delete(settings).run()
    tx.delete(monthRates).run()
    tx.delete(bankAccount).run()
  }

  tx.insert(settings)
    .values({
      id: 1,
      groupName: 'Associação Chácaras do Pinhal',
      dueDay: 10,
    })
    .run()

  tx.insert(bankAccount)
    .values({
      id: 1,
      bankName: 'Banco do Brasil',
      bankCode: '001',
      branch: '1234-5',
      accountNumber: '56789-0',
      accountType: 'corrente',
      pixKeyType: 'email',
      pixKey: 'rateio.pinhal@exemplo.com.br',
      holderName: 'Associação Chácaras do Pinhal',
      holderCity: 'Itatiba',
    })
    .run()

  const thisMonth = currentPeriod()
  const firstMonth = addMonths(thisMonth, -17)

  // The kWh price went up in January; the reserve fund stayed the same.
  for (let offset = 0; offset < 18; offset++) {
    const period = addMonths(firstMonth, offset)
    tx.insert(monthRates)
      .values({
        ...period,
        kwhPriceMicros: priceFor(period),
        reserveFundCents: 1000,
      })
      .run()
  }

  CHACARAS.forEach((chacara, index) => {
    const owner = tx
      .insert(owners)
      .values({
        name: chacara.owner,
        phone: `(11) 9${String(8100_0000 + index * 1_234_567).slice(0, 4)}-${String(1000 + index * 731).slice(0, 4)}`,
        email: `${chacara.owner.split(' ')[0]?.toLowerCase()}@exemplo.com.br`,
      })
      .returning()
      .get()

    const property = tx
      .insert(properties)
      .values({
        name: chacara.name,
        ownerId: owner.id,
        street: 'Estrada Municipal do Pinhal',
        number: String(120 + index * 85),
        district: 'Bairro do Pinhal',
        city: 'Itatiba',
        state: 'SP',
        zipCode: '13250-000',
        meterNumber: `A${String(576_440 + index * 3)}`,
      })
      .returning()
      .get()

    let reading = chacara.start
    for (let offset = 0; offset < 18; offset++) {
      const period = addMonths(firstMonth, offset)
      const isThisMonth = offset === 17
      // This month is still being filled in: only some chácaras were read.
      if (isThisMonth && index % 3 !== 0) continue

      const used = Math.round(
        chacara.base * seasonal(period.month) * (0.8 + random() * 0.4),
      )
      const ageInMonths = 17 - offset
      const paid = ageInMonths >= 2 || (ageInMonths === 1 && random() > 0.55)
      tx.insert(readings)
        .values({
          propertyId: property.id,
          ...period,
          previousReading: reading,
          currentReading: reading + used,
          kwhPriceMicros: priceFor(period),
          reserveFundCents: 1000,
          paid,
          paidAt: paid
            ? `${addMonths(period, 1).year}-${String(addMonths(period, 1).month).padStart(2, '0')}-0${1 + Math.floor(random() * 9)}`
            : null,
          readingDate: `${period.year}-${String(period.month).padStart(2, '0')}-10`,
        })
        .run()
      reading += used
    }
  })
})

console.log(
  `Dados de exemplo criados: ${CHACARAS.length} chácaras com 18 meses de leituras.`,
)
