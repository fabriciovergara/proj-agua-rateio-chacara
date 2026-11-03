import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { getDb } from '#/db/client.server'
import { todayISO } from '#/lib/periods'
import { idSchema, tankReadingSchema } from '#/lib/schemas'
import { isUnlockedWithEnvPassword } from './auth.server'
import * as repo from './tank.server'

export const getTankPage = createServerFn({ method: 'GET' }).handler(() => {
  const db = getDb()
  return {
    ...repo.getTankPage(db, todayISO()),
    /** Old readings come in through Configurações → Importar dados. */
    canImport: isUnlockedWithEnvPassword(db, getRequest()),
  }
})

export const saveTankReading = createServerFn({ method: 'POST' })
  .validator(tankReadingSchema)
  .handler(({ data }) => {
    const { id } = repo.saveTankReading(getDb(), data, todayISO())
    return { id }
  })

export const deleteTankReading = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema }))
  .handler(({ data }) => {
    repo.deleteTankReading(getDb(), data.id)
    return { ok: true as const }
  })
