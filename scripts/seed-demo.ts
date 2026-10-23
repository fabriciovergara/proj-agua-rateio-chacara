/**
 * Fills the database with fictitious chácaras, owners and 18 monthly
 * periods of water meter readings, so the app can be explored before real
 * data is typed in.
 *
 *   bun run db:seed            # only on an empty database
 *   bun run db:seed --reset    # wipes everything first
 */
import { and, eq } from 'drizzle-orm'
import { getDb } from '#/db/client.server'
import {
  bankAccount,
  owners,
  periods,
  properties,
  readings,
  settings,
} from '#/db/schema'
import { addMonthsToDate, todayISO } from '#/lib/periods'
import { deleteAllData } from '#/server/data.server'
import { repricePeriod } from '#/server/periods.server'

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

/** m³ a month (`base`) and the meter's first number (`start`). */
const CHACARAS = [
  { name: 'Chácara 12', owner: 'Ana Paula Ribeiro', base: 14, start: 1180 },
  { name: 'Chácara 14', owner: 'Benedito Souza', base: 22, start: 4210 },
  { name: 'Chácara 15', owner: 'Carmem Lúcia Prado', base: 8, start: 860 },
  { name: 'Chácara 21', owner: 'Dirceu Almeida', base: 35, start: 10_420 },
  {
    name: 'Recanto das Palmeiras',
    owner: 'Elza Moreira',
    base: 17,
    start: 2675,
  },
  {
    name: 'Sítio Boa Vista',
    owner: 'Francisco Teixeira',
    base: 46,
    start: 15_890,
  },
  { name: 'Chácara 27', owner: 'Geraldo Pires', base: 5, start: 512 },
  { name: 'Chácara 30', owner: 'Helena Campos', base: 20, start: 3390 },
]

/** Gardens need more water in the dry winter months (June–September). */
function seasonal(month: number) {
  return [1, 0.95, 0.9, 0.95, 1.05, 1.2, 1.3, 1.35, 1.25, 1.05, 0.95, 1][
    month - 1
  ] as number
}

const PERIODS = 18

db.transaction((tx) => {
  if (reset) deleteAllData(tx)

  tx.insert(settings)
    .values({
      id: 1,
      groupName: 'Associação Chácaras do Pinhal',
      dueDay: 20,
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

  // The meters are read on the 10th; the newest period ended on the last one.
  const today = todayISO()
  const lastEnd =
    `${today.slice(0, 8)}10` <= today
      ? `${today.slice(0, 8)}10`
      : addMonthsToDate(`${today.slice(0, 8)}10`, -1)
  const ends = Array.from({ length: PERIODS }, (_, index) =>
    addMonthsToDate(lastEnd, index - PERIODS + 1),
  )
  const created = ends.map((endDate) =>
    tx
      .insert(periods)
      .values({
        startDate: addMonthsToDate(endDate, -1),
        endDate,
        energyBillCents: null,
        reserveFundCents: 1000,
      })
      .returning()
      .get(),
  )

  const meters = CHACARAS.map((chacara, index) => {
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
    return {
      ...chacara,
      index,
      propertyId: property.id,
      reading: chacara.start,
    }
  })

  created.forEach((period, offset) => {
    const newest = offset === PERIODS - 1
    const month = Number(period.endDate.slice(5, 7))
    let water = 0
    for (const meter of meters) {
      // The newest period is still being read: only some chácaras so far.
      if (newest && meter.index % 3 !== 0) continue
      const used = Math.round(
        meter.base * seasonal(month) * (0.8 + random() * 0.4),
      )
      tx.insert(readings)
        .values({
          propertyId: meter.propertyId,
          periodId: period.id,
          previousReading: meter.reading,
          currentReading: meter.reading + used,
          // One chácara was read two days late.
          endDate:
            meter.index === 4 && offset === PERIODS - 3
              ? period.endDate.replace(/-10$/, '-12')
              : null,
          energyCents: null,
          reserveFundCents: period.reserveFundCents,
        })
        .run()
      meter.reading += used
      water += used
    }

    // The pump's electricity bill: about R$ 1,60 per m³ pumped (R$ 1,85
    // from January), and the newest bill hasn't arrived yet.
    if (!newest) {
      const perCubicMeter = period.endDate >= '2026-01' ? 185 : 160
      tx.update(periods)
        .set({
          energyBillCents: Math.round(
            water * perCubicMeter * (0.95 + random() * 0.1),
          ),
        })
        .where(eq(periods.id, period.id))
        .run()
      repricePeriod(tx, period.id)
    }

    // Older bills are paid; the one before the newest, partly.
    const age = PERIODS - 1 - offset
    if (age >= 1) {
      const paidOn = addMonthsToDate(period.endDate, 1).replace(
        /-\d\d$/,
        `-0${1 + Math.floor(random() * 9)}`,
      )
      for (const meter of meters) {
        if (age === 1 && random() > 0.55) continue
        tx.update(readings)
          .set({ paid: true, paidAt: paidOn })
          .where(
            and(
              eq(readings.propertyId, meter.propertyId),
              eq(readings.periodId, period.id),
            ),
          )
          .run()
      }
    }
  })
})

console.log(
  `Dados de exemplo criados: ${CHACARAS.length} chácaras com ${PERIODS} períodos de leituras.`,
)
