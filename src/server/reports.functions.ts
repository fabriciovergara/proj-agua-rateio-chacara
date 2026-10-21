import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb } from '#/db/client.server'
import { currentPeriod } from '#/lib/periods'
import { idSchema, monthSchema, yearSchema } from '#/lib/schemas'
import { getChartData as chartData } from './charts.server'
import { listOwners } from './owners.server'
import { listProperties } from './properties.server'
import { latestReadingPeriod, listYears } from './readings.server'
import * as repo from './reports.server'

/** Options for the report filters: chácaras, owners and years with data. */
export const getReportOptions = createServerFn({ method: 'GET' }).handler(
  () => {
    const db = getDb()
    return {
      properties: listProperties(db).map(({ id, name, owner }) => ({
        id,
        name,
        ownerName: owner?.name ?? null,
      })),
      owners: listOwners(db).map(({ id, name }) => ({ id, name })),
      years: listYears(db),
      currentPeriod: currentPeriod(),
      /** Reports open on the latest month that has readings. */
      defaultPeriod: latestReadingPeriod(db) ?? currentPeriod(),
    }
  },
)

export const getMonthlyBills = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      year: yearSchema,
      month: monthSchema,
      propertyId: idSchema.optional(),
    }),
  )
  .handler(({ data }) =>
    repo.getMonthlyBills(getDb(), {
      period: { year: data.year, month: data.month },
      propertyId: data.propertyId,
    }),
  )

export const getAnnualReport = createServerFn({ method: 'GET' })
  .validator(z.object({ ownerId: idSchema, year: yearSchema }))
  .handler(({ data }) => repo.getAnnualReport(getDb(), data))

export const getChartData = createServerFn({ method: 'GET' })
  .validator(
    z.object({ year: yearSchema.optional(), propertyId: idSchema.optional() }),
  )
  .handler(({ data }) => chartData(getDb(), data))
