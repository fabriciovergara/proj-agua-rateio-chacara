import { createServerFn } from '@tanstack/react-start'
import {
  deleteCookie,
  getRequest,
  setCookie,
} from '@tanstack/react-start/server'
import { z } from 'zod'
import { getDb } from '#/db/client.server'
import { MIN_PASSWORD_LENGTH } from '#/lib/domain'
import { UserFacingError } from '#/lib/errors'
import { bankAccountSchema, settingsSchema } from '#/lib/schemas'
import * as auth from './auth.server'
import * as repo from './settings.server'

export const getSettings = createServerFn({ method: 'GET' }).handler(() => {
  const db = getDb()
  return {
    settings: repo.getSettings(db),
    bank: repo.getBankAccount(db),
    /** Which passwords exist — booleans only, never the passwords. */
    lock: auth.lockStatus(db),
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

/** The current password is checked here too: same brake as the unlock page. */
async function checkingCurrentPassword(run: () => Promise<void>) {
  const key = auth.clientKey(getRequest())
  if (!auth.takeAttempt(key)) {
    throw new UserFacingError(
      'Muitas tentativas erradas. Espere 15 minutos e tente de novo.',
    )
  }
  await run()
  auth.forgiveAttempt(key)
}

/** Changing a password signs every browser out; keep this one signed in. */
function keepThisBrowserUnlocked() {
  const db = getDb()
  if (!auth.lockStatus(db).locked) {
    deleteCookie(auth.SESSION_COOKIE, { path: '/' })
    return
  }
  const { token, maxAge } = auth.createSession(db)
  setCookie(
    auth.SESSION_COOKIE,
    token,
    auth.sessionCookieOptions(getRequest(), maxAge),
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
    await checkingCurrentPassword(() => auth.setAppPassword(getDb(), data))
    keepThisBrowserUnlocked()
    return { ok: true as const }
  })

export const removeAppPassword = createServerFn({ method: 'POST' })
  .validator(z.object({ current: z.string().max(200) }))
  .handler(async ({ data }) => {
    await checkingCurrentPassword(() => auth.removeAppPassword(getDb(), data))
    keepThisBrowserUnlocked()
    return { ok: true as const }
  })
