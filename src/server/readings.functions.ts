import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb } from '#/db/client.server'
import { todayISO } from '#/lib/periods'
import {
  idSchema,
  newPeriodSchema,
  periodSheetSchema,
  readingSchema,
  setPaidSchema,
  updateReadingSchema,
  yearSchema,
} from '#/lib/schemas'
import * as periods from './periods.server'
import * as repo from './readings.server'

export const getPeriodSheet = createServerFn({ method: 'GET' })
  .validator(z.object({ periodId: idSchema.optional() }))
  .handler(({ data }) =>
    repo.getPeriodSheet(getDb(), data.periodId, todayISO()),
  )

export const savePeriodSheet = createServerFn({ method: 'POST' })
  .validator(periodSheetSchema)
  .handler(({ data }) => repo.savePeriodSheet(getDb(), data))

export const createPeriod = createServerFn({ method: 'POST' })
  .validator(newPeriodSchema)
  .handler(({ data }) => {
    const { id } = periods.createPeriod(getDb(), data)
    return { id }
  })

export const deletePeriod = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema }))
  .handler(({ data }) => {
    periods.deletePeriod(getDb(), data.id)
    return { ok: true as const }
  })

export const setPaid = createServerFn({ method: 'POST' })
  .validator(setPaidSchema)
  .handler(({ data }) => repo.setPaid(getDb(), data, todayISO()))

export const getPropertySheet = createServerFn({ method: 'GET' })
  .validator(z.object({ propertyId: idSchema }))
  .handler(({ data }) => {
    const sheet = repo.getPropertySheet(getDb(), data.propertyId)
    if (!sheet) throw notFound()
    return sheet
  })

export const createReading = createServerFn({ method: 'POST' })
  .validator(readingSchema)
  .handler(({ data }) => repo.createReading(getDb(), data, todayISO()))

export const updateReading = createServerFn({ method: 'POST' })
  .validator(updateReadingSchema)
  .handler(({ data }) => repo.updateReading(getDb(), data, todayISO()))

export const deleteReading = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema }))
  .handler(({ data }) => {
    repo.deleteReading(getDb(), data.id)
    return { ok: true as const }
  })

export const getHistory = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      propertyId: idSchema.optional(),
      year: yearSchema.optional(),
      status: z.enum(['pago', 'pendente']).optional(),
    }),
  )
  .handler(({ data }) => {
    const db = getDb()
    return {
      rows: repo.listHistory(db, data),
      years: repo.listYears(db),
    }
  })
