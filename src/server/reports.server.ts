import { asc, eq } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import { owners, periods, properties, readings } from '#/db/schema'
import { consumptionOf } from '#/lib/billing'
import { dueDateFor, formatMonthYear, yearOf } from '#/lib/periods'
import { tryBuildPixPayload } from '#/lib/pix'
import { getPeriod } from './periods.server'
import { presentReadings } from './readings.server'
import { getBankAccount, getSettings } from './settings.server'

const byName = new Intl.Collator('pt-BR', {
  numeric: true,
  sensitivity: 'base',
})

/**
 * "Cobranças do período": one bill per chácara, with how the electricity
 * bill was split, the payment details and Pix.
 */
export function getPeriodBills(
  db: Executor,
  options: { periodId: number; propertyId?: number },
) {
  const period = getPeriod(db, options.periodId)
  if (!period) return null
  const defaults = getSettings(db)
  const bank = getBankAccount(db)
  const pixKey = bank?.pixKey
  const pixKeyType = bank?.pixKeyType
  const holderName = bank?.holderName
  const holderCity = bank?.holderCity

  const inPeriod = db
    .select({ property: properties, owner: owners, readingId: readings.id })
    .from(readings)
    .innerJoin(properties, eq(properties.id, readings.propertyId))
    .leftJoin(owners, eq(owners.id, properties.ownerId))
    .where(eq(readings.periodId, period.id))
    .all()
  const views = presentReadings(
    db,
    inPeriod.map(({ property }) => property.id),
  )
  const all = inPeriod.flatMap(({ property, owner, readingId }) => {
    const reading = views.get(readingId)
    return reading ? [{ reading, property, owner }] : []
  })

  const bills = all
    .filter(
      ({ property }) =>
        !options.propertyId || property.id === options.propertyId,
    )
    .sort((a, b) => byName.compare(a.property.name, b.property.name))
    .map(({ reading, property, owner }) => {
      const amount = reading.bill.totalCents
      const canPay =
        !reading.paid &&
        amount !== null &&
        amount > 0 &&
        pixKey &&
        pixKeyType &&
        holderName &&
        holderCity
      return {
        reading,
        property,
        owner,
        pixPayload: canPay
          ? tryBuildPixPayload({
              key: pixKey,
              keyType: pixKeyType,
              name: holderName,
              city: holderCity,
              amountCents: amount,
              description: `${property.name} ${formatMonthYear(period.endDate)}`,
            })
          : null,
      }
    })

  return {
    period,
    /** Water used by every chácara read in the period: the split's base. */
    consumption: all.reduce(
      (sum, { reading }) => sum + reading.bill.consumption,
      0,
    ),
    groupName: defaults?.groupName ?? null,
    dueDate: defaults?.dueDay
      ? dueDateFor(period.endDate, defaults.dueDay)
      : null,
    bank,
    /** True when the bank details lack what a Pix QR code needs. */
    pixMissing: !(pixKey && pixKeyType && holderName && holderCity),
    bills,
  }
}

export type PeriodBills = NonNullable<ReturnType<typeof getPeriodBills>>

/** "Relatório anual": the periods ending in a year, for one owner's chácaras. */
export function getAnnualReport(
  db: Executor,
  options: { ownerId: number; year: number },
) {
  const owner = db
    .select()
    .from(owners)
    .where(eq(owners.id, options.ownerId))
    .get()
  if (!owner) return null

  const owned = db
    .select()
    .from(properties)
    .where(eq(properties.ownerId, owner.id))
    .all()
    .sort((a, b) => byName.compare(a.name, b.name))
  const yearPeriods = db
    .select()
    .from(periods)
    .orderBy(asc(periods.startDate))
    .all()
    .filter((period) => yearOf(period.endDate) === options.year)
  const views = [
    ...presentReadings(
      db,
      owned.map((property) => property.id),
    ).values(),
  ]

  const emptyTotals = () => ({
    consumption: 0,
    totalCents: 0,
    paidCents: 0,
    pendingCents: 0,
  })
  const grandTotals = emptyTotals()

  const chacaras = owned.map((property) => {
    const totals = emptyTotals()
    const rows = yearPeriods.map((period) => {
      const reading =
        views.find(
          (r) => r.propertyId === property.id && r.periodId === period.id,
        ) ?? null
      if (reading) {
        const amount = reading.bill.totalCents ?? 0
        for (const target of [totals, grandTotals]) {
          target.consumption += consumptionOf(reading)
          target.totalCents += amount
          if (reading.paid) target.paidCents += amount
          else target.pendingCents += amount
        }
      }
      return { period, reading }
    })
    return { property, rows, totals }
  })

  const defaults = getSettings(db)
  return {
    owner,
    year: options.year,
    groupName: defaults?.groupName ?? null,
    chacaras,
    totals: grandTotals,
  }
}

export type AnnualReport = NonNullable<ReturnType<typeof getAnnualReport>>
