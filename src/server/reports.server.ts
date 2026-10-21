import { and, eq, inArray } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import { owners, properties, readings } from '#/db/schema'
import {
  dueDateFor,
  formatPeriodShort,
  MONTH_NAMES,
  type Period,
} from '#/lib/periods'
import { tryBuildPixPayload } from '#/lib/pix'
import { withBill } from './readings.server'
import { getBankAccount, getSettings } from './settings.server'

const byName = new Intl.Collator('pt-BR', {
  numeric: true,
  sensitivity: 'base',
})

/** "Relatório mensal": one bill per chácara, with payment details and Pix. */
export function getMonthlyBills(
  db: Executor,
  options: { period: Period; propertyId?: number },
) {
  const { period, propertyId } = options
  const defaults = getSettings(db)
  const bank = getBankAccount(db)
  const pixKey = bank?.pixKey
  const pixKeyType = bank?.pixKeyType
  const holderName = bank?.holderName
  const holderCity = bank?.holderCity

  const rows = db
    .select({ reading: readings, property: properties, owner: owners })
    .from(readings)
    .innerJoin(properties, eq(properties.id, readings.propertyId))
    .leftJoin(owners, eq(owners.id, properties.ownerId))
    .where(
      and(
        eq(readings.year, period.year),
        eq(readings.month, period.month),
        propertyId ? eq(readings.propertyId, propertyId) : undefined,
      ),
    )
    .all()
    .sort((a, b) => byName.compare(a.property.name, b.property.name))

  const bills = rows.map(({ reading, property, owner }) => {
    const priced = withBill(reading)
    const canPay =
      !priced.paid &&
      priced.bill.totalCents > 0 &&
      pixKey &&
      pixKeyType &&
      holderName &&
      holderCity
    return {
      reading: priced,
      property,
      owner,
      pixPayload: canPay
        ? tryBuildPixPayload({
            key: pixKey,
            keyType: pixKeyType,
            name: holderName,
            city: holderCity,
            amountCents: priced.bill.totalCents,
            description: `${property.name} ${formatPeriodShort(period)}`,
          })
        : null,
    }
  })

  return {
    period,
    groupName: defaults?.groupName ?? null,
    dueDate: defaults?.dueDay ? dueDateFor(period, defaults.dueDay) : null,
    bank,
    /** True when the bank details lack what a Pix QR code needs. */
    pixMissing: !(pixKey && pixKeyType && holderName && holderCity),
    bills,
  }
}

export type MonthlyBills = ReturnType<typeof getMonthlyBills>

/** "Relatório anual": the 12 months of one owner's chácaras. */
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

  const yearReadings = owned.length
    ? db
        .select()
        .from(readings)
        .where(
          and(
            inArray(
              readings.propertyId,
              owned.map((property) => property.id),
            ),
            eq(readings.year, options.year),
          ),
        )
        .all()
        .map(withBill)
    : []

  const emptyTotals = () => ({
    consumption: 0,
    totalCents: 0,
    paidCents: 0,
    pendingCents: 0,
  })
  const grandTotals = emptyTotals()

  const chacaras = owned.map((property) => {
    const totals = emptyTotals()
    const months = MONTH_NAMES.map((name, index) => {
      const reading =
        yearReadings.find(
          (r) => r.propertyId === property.id && r.month === index + 1,
        ) ?? null
      if (reading) {
        for (const target of [totals, grandTotals]) {
          target.consumption += reading.bill.consumption
          target.totalCents += reading.bill.totalCents
          if (reading.paid) target.paidCents += reading.bill.totalCents
          else target.pendingCents += reading.bill.totalCents
        }
      }
      return { month: index + 1, name, reading }
    })
    return { property, months, totals }
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
