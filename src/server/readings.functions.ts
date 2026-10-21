import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb } from '#/db/client.server'
import { currentPeriod, todayISO } from '#/lib/periods'
import {
  idSchema,
  monthEntriesSchema,
  monthSchema,
  readingSchema,
  setPaidSchema,
  updateReadingSchema,
  yearSchema,
} from '#/lib/schemas'
import * as repo from './readings.server'

const optionalPeriod = z.object({
  year: yearSchema.optional(),
  month: monthSchema.optional(),
})

export const getMonthSheet = createServerFn({ method: 'GET' })
  .validator(optionalPeriod)
  .handler(({ data }) => {
    const thisMonth = currentPeriod()
    const period =
      data.year && data.month
        ? { year: data.year, month: data.month }
        : thisMonth
    return { ...repo.getMonthSheet(getDb(), period), thisMonth }
  })

export const saveMonthReadings = createServerFn({ method: 'POST' })
  .validator(monthEntriesSchema)
  .handler(({ data }) => repo.saveMonthReadings(getDb(), data, todayISO()))

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
