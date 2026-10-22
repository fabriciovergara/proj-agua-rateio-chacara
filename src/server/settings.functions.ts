import { createServerFn } from '@tanstack/react-start'
import {
  deleteCookie,
  getRequest,
  setCookie,
} from '@tanstack/react-start/server'
import { z } from 'zod'
import { type DB, getDb } from '#/db/client.server'
import { MIN_PASSWORD_LENGTH } from '#/lib/domain'
import { bankAccountSchema, settingsSchema } from '#/lib/schemas'
import * as auth from './auth.server'
import { dataSummary } from './data.server'
import * as repo from './settings.server'

export const getSettings = createServerFn({ method: 'GET' }).handler(() => {
  const db = getDb()
  return {
    settings: repo.getSettings(db),
    bank: repo.getBankAccount(db),
    /** Which passwords exist — booleans only, never the passwords. */
    lock: auth.lockStatus(db),
    /**
     * Only for a browser unlocked with APP_PASSWORD, which also gets
     * "Importar dados" and "Apagar todos os dados": how much data there is.
     */
    admin: auth.isUnlockedWithEnvPassword(db, getRequest())
      ? dataSummary(db)
      : null,
  }
})

export const saveSettings = createServerFn({ method: 'POST' })
  .validator(settingsSchema)
  .handler(({ data }) => repo.saveSettings(getDb(), data))

export const saveBankAccount = createServerFn({ method: 'POST' })
  .validator(bankAccountSchema)
  .handler(({ data }) => repo.saveBankAccount(getDb(), data))

export const clearBankAccount = createServerFn({ method: 'POST' }).handler(
  () => {
    repo.clearBankAccount(getDb())
    return { ok: true as const }
  },
)

/**
 * Changes a password. The current one goes through the same brake as the
 * unlock page. Every browser is signed out except this one, which keeps
 * what APP_PASSWORD allows if it had it or if that is the password just
 * typed as the current one.
 */
async function changingPassword(
  change: (db: DB) => Promise<auth.PasswordKind | null>,
) {
  const db = getDb()
  const request = getRequest()
  const hadEnvPassword = auth.isUnlockedWithEnvPassword(db, request)
  const typed = await auth.withPasswordBrake(request, () => change(db))
  if (!auth.lockStatus(db).locked) {
    deleteCookie(auth.SESSION_COOKIE, { path: '/' })
    return
  }
  const { token, maxAge } = auth.createSession(db, {
    withEnvPassword: hadEnvPassword || typed === 'env',
  })
  setCookie(
    auth.SESSION_COOKIE,
    token,
    auth.sessionCookieOptions(request, maxAge),
  )
}

export const setAppPassword = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      current: z.string().max(200),
      password: z
        .string()
        .min(
          MIN_PASSWORD_LENGTH,
          `Use pelo menos ${MIN_PASSWORD_LENGTH} letras ou números.`,
        )
        .max(200, 'Use no máximo 200 caracteres.'),
    }),
  )
  .handler(async ({ data }) => {
    await changingPassword((db) => auth.setAppPassword(db, data))
    return { ok: true as const }
  })

export const removeAppPassword = createServerFn({ method: 'POST' })
  .validator(z.object({ current: z.string().max(200) }))
  .handler(async ({ data }) => {
    await changingPassword((db) => auth.removeAppPassword(db, data))
    return { ok: true as const }
  })
