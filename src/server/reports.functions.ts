import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb } from '#/db/client.server'
import { todayISO, yearOf } from '#/lib/periods'
import { idSchema, yearSchema } from '#/lib/schemas'
import { getChartData as chartData } from './charts.server'
import { listOwners } from './owners.server'
import { latestPeriod, listPeriods } from './periods.server'
import { listProperties } from './properties.server'
import { listYears } from './readings.server'
import * as repo from './reports.server'

/** Options for the report filters: chácaras, owners, periods and years. */
export const getReportOptions = createServerFn({ method: 'GET' }).handler(
  () => {
    const db = getDb()
    const latest = latestPeriod(db)
    return {
      properties: listProperties(db).map(({ id, name, owner }) => ({
        id,
        name,
        ownerName: owner?.name ?? null,
      })),
      owners: listOwners(db).map(({ id, name }) => ({ id, name })),
      periods: listPeriods(db),
      years: listYears(db),
      /** Reports open on the newest period and its year. */
      defaultPeriodId: latest?.id ?? null,
      defaultYear: latest ? yearOf(latest.endDate) : yearOf(todayISO()),
    }
  },
)

export const getPeriodBills = createServerFn({ method: 'GET' })
  .validator(z.object({ periodId: idSchema, propertyId: idSchema.optional() }))
  .handler(({ data }) => repo.getPeriodBills(getDb(), data))

export const getAnnualReport = createServerFn({ method: 'GET' })
  .validator(z.object({ ownerId: idSchema, year: yearSchema }))
  .handler(({ data }) => repo.getAnnualReport(getDb(), data))

export const getChartData = createServerFn({ method: 'GET' })
  .validator(
    z.object({ year: yearSchema.optional(), propertyId: idSchema.optional() }),
  )
  .handler(({ data }) => chartData(getDb(), data))
