import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type DB, openDatabase } from '#/db/client.server'
import { appPassword, sessions } from '#/db/schema'
import {
  authorizeExport,
  bearerToken,
  checkPassword,
  clientKey,
  createSession,
  deleteSession,
  forgiveAttempt,
  isUnlocked,
  isValidSession,
  lockStatus,
  readCookie,
  removeAppPassword,
  resetAttempts,
  SESSION_COOKIE,
  safeReturnPath,
  serializeCookie,
  sessionCookieOptions,
  setAppPassword,
  takeAttempt,
} from './auth.server'

const originalEnv = process.env.APP_PASSWORD
let db: DB

beforeEach(() => {
  db = openDatabase(':memory:')
  delete process.env.APP_PASSWORD
  resetAttempts()
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env.APP_PASSWORD
  else process.env.APP_PASSWORD = originalEnv
})

function requestWith(token?: string) {
  return new Request('http://localhost/', {
    headers: token ? { cookie: `tema=claro; ${SESSION_COOKIE}=${token}` } : {},
  })
}

describe('lock status', () => {
  test('without any password the app is open', () => {
    expect(lockStatus(db)).toEqual({
      envPassword: false,
      appPassword: false,
      locked: false,
    })
    expect(isUnlocked(db, requestWith())).toBe(true)
  })

  test('APP_PASSWORD locks the app and unlocks it', async () => {
    process.env.APP_PASSWORD = '  senha-do-servidor\n'
    expect(lockStatus(db)).toEqual({
      envPassword: true,
      appPassword: false,
      locked: true,
    })
    expect(isUnlocked(db, requestWith())).toBe(false)
    expect(await checkPassword(db, 'senha-do-servidor')).toBe(true)
    expect(await checkPassword(db, 'senha-do-servidor ')).toBe(false)
    expect(await checkPassword(db, '')).toBe(false)
  })

  test('a blank APP_PASSWORD does not lock the app', () => {
    process.env.APP_PASSWORD = '   '
    expect(lockStatus(db).locked).toBe(false)
  })
})

describe('app password', () => {
  test('the first one needs no current password', async () => {
    await setAppPassword(db, { current: '', password: 'chacara-15' })
    expect(lockStatus(db)).toEqual({
      envPassword: false,
      appPassword: true,
      locked: true,
    })
    expect(await checkPassword(db, 'chacara-15')).toBe(true)
    expect(await checkPassword(db, 'chacara-16')).toBe(false)
  })

  test('is stored as an argon2 hash, never as typed', async () => {
    await setAppPassword(db, { current: '', password: 'chacara-15' })
    const stored = db.select().from(appPassword).all()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.hash.startsWith('$argon2id$')).toBe(true)
    expect(stored[0]?.hash).not.toContain('chacara-15')
  })

  test('rejects short passwords', async () => {
    await expect(
      setAppPassword(db, { current: '', password: '12345' }),
    ).rejects.toThrow('Use pelo menos 6 letras ou números.')
  })

  test('changing it asks for the current password, either one', async () => {
    process.env.APP_PASSWORD = 'senha-do-servidor'
    await expect(
      setAppPassword(db, { current: 'errada', password: 'chacara-15' }),
    ).rejects.toThrow('A senha atual está errada.')
    expect(lockStatus(db).appPassword).toBe(false)

    await setAppPassword(db, {
      current: 'senha-do-servidor',
      password: 'chacara-15',
    })
    await setAppPassword(db, { current: 'chacara-15', password: 'chacara-16' })
    expect(await checkPassword(db, 'chacara-16')).toBe(true)
    expect(await checkPassword(db, 'chacara-15')).toBe(false)
    expect(await checkPassword(db, 'senha-do-servidor')).toBe(true)
  })

  test('removing it asks for the current password; APP_PASSWORD stays', async () => {
    process.env.APP_PASSWORD = 'senha-do-servidor'
    await setAppPassword(db, {
      current: 'senha-do-servidor',
      password: 'chacara-15',
    })
    await expect(removeAppPassword(db, { current: 'errada' })).rejects.toThrow(
      'A senha atual está errada.',
    )
    expect(lockStatus(db).appPassword).toBe(true)

    await removeAppPassword(db, { current: 'chacara-15' })
    expect(lockStatus(db)).toEqual({
      envPassword: true,
      appPassword: false,
      locked: true,
    })
    delete process.env.APP_PASSWORD
    expect(lockStatus(db).locked).toBe(false)
  })
})

describe('sessions', () => {
  test('a session unlocks this browser until it signs out', async () => {
    await setAppPassword(db, { current: '', password: 'chacara-15' })
    const { token, maxAge } = createSession(db)
    expect(maxAge).toBe(60 * 86_400)
    expect(isUnlocked(db, requestWith(token))).toBe(true)
    expect(isUnlocked(db, requestWith('inventado'))).toBe(false)
    expect(isUnlocked(db, requestWith())).toBe(false)

    deleteSession(db, token)
    expect(isUnlocked(db, requestWith(token))).toBe(false)
  })

  test('only a hash of the token is stored', () => {
    process.env.APP_PASSWORD = 'senha-do-servidor'
    const { token } = createSession(db)
    const stored = db.select().from(sessions).all()
    expect(stored).toHaveLength(1)
    expect(JSON.stringify(stored)).not.toContain(token)
  })

  test('changing the app password signs every browser out', async () => {
    await setAppPassword(db, { current: '', password: 'chacara-15' })
    const { token } = createSession(db)
    await setAppPassword(db, { current: 'chacara-15', password: 'chacara-16' })
    expect(isValidSession(db, token)).toBe(false)
  })

  test('changing APP_PASSWORD signs every browser out', () => {
    process.env.APP_PASSWORD = 'primeira-senha'
    const { token } = createSession(db)
    expect(isValidSession(db, token)).toBe(true)
    process.env.APP_PASSWORD = 'segunda-senha'
    expect(isValidSession(db, token)).toBe(false)
  })

  test('expired sessions do not unlock and are cleaned up', () => {
    process.env.APP_PASSWORD = 'senha-do-servidor'
    const { token } = createSession(db)
    db.update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run()
    expect(isValidSession(db, token)).toBe(false)

    createSession(db)
    expect(db.select().from(sessions).all()).toHaveLength(1)
  })
})

describe('cookies', () => {
  test('reads the session cookie among others', () => {
    expect(readCookie('a=1; rateio_sessao=abc%3D; b=2', SESSION_COOKIE)).toBe(
      'abc=',
    )
    expect(readCookie('xrateio_sessao=1', SESSION_COOKIE)).toBeUndefined()
    expect(readCookie(null, SESSION_COOKIE)).toBeUndefined()
    expect(readCookie('rateio_sessao=%E0%A4%A', SESSION_COOKIE)).toBeUndefined()
  })

  test('the session cookie is HttpOnly and SameSite, Secure on https', () => {
    const plain = new Request('http://localhost/')
    expect(
      serializeCookie(SESSION_COOKIE, 'abc', sessionCookieOptions(plain, 60)),
    ).toBe('rateio_sessao=abc; Path=/; Max-Age=60; HttpOnly; SameSite=Lax')

    const proxied = new Request('http://interno/', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    expect(sessionCookieOptions(proxied, 60).secure).toBe(true)
  })
})

describe('return path after unlocking', () => {
  test('keeps paths of this site', () => {
    expect(safeReturnPath('/historico?ano=2026')).toBe('/historico?ano=2026')
    expect(safeReturnPath('/chacaras/3')).toBe('/chacaras/3')
  })

  test('never leads to another site', () => {
    for (const trick of [
      'https://golpe.example',
      '//golpe.example',
      '/\\golpe.example',
      '/\t/golpe.example',
      'golpe.example',
    ]) {
      expect(safeReturnPath(trick)).toBe('/')
    }
  })

  test('skips the unlock page and the api', () => {
    expect(safeReturnPath('/desbloquear?voltar=/')).toBe('/')
    expect(safeReturnPath('/api/backup')).toBe('/')
    expect(safeReturnPath(undefined)).toBe('/')
  })
})

describe('wrong password brake', () => {
  const start = 1_000_000
  const take = (key: string, times: number, now = start) =>
    Array.from({ length: times }, () => takeAttempt(key, now))

  test('stops a client after 10 attempts, for 15 minutes', () => {
    expect(take('a', 10).every(Boolean)).toBe(true)
    expect(takeAttempt('a', start + 60_000)).toBe(false)
    expect(takeAttempt('b', start + 60_000)).toBe(true)
    expect(takeAttempt('a', start + 15 * 60_000 + 1)).toBe(true)
  })

  test('a right password lets the client start over', () => {
    take('a', 10)
    forgiveAttempt('a', start)
    expect(takeAttempt('a', start)).toBe(true)
  })

  test('stops everyone after 30 attempts in total', () => {
    for (let i = 0; i < 30; i++) takeAttempt(`forjado-${i}`, start)
    expect(takeAttempt('novo', start)).toBe(false)
    expect(takeAttempt('novo', start + 15 * 60_000 + 1)).toBe(true)
  })

  test('right passwords do not use up the total', () => {
    for (let i = 0; i < 40; i++) {
      expect(takeAttempt(`vizinho-${i}`, start)).toBe(true)
      forgiveAttempt(`vizinho-${i}`, start)
    }
  })

  test('uses the address the nearest proxy saw', () => {
    const request = (headers: Record<string, string>) =>
      new Request('http://localhost/', { headers })
    expect(
      clientKey(request({ 'x-forwarded-for': 'forjado, 203.0.113.9' })),
    ).toBe('203.0.113.9')
    expect(clientKey(request({ 'x-real-ip': '203.0.113.7' }))).toBe(
      '203.0.113.7',
    )
    expect(clientKey(request({}))).toBe('local')
  })
})

describe('backup export for scripts', () => {
  const exportRequest = (headers: Record<string, string> = {}) =>
    new Request('http://localhost/api/exportar', { headers })
  const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` })

  test('is off without APP_PASSWORD, even with an app password', async () => {
    await setAppPassword(db, { current: '', password: 'chacara-15' })
    expect(authorizeExport(exportRequest(bearer('chacara-15')))).toBe(
      'disabled',
    )
  })

  test('takes APP_PASSWORD as a bearer token, and nothing else', () => {
    process.env.APP_PASSWORD = 'senha-do-servidor'
    expect(authorizeExport(exportRequest())).toBe('denied')
    expect(authorizeExport(exportRequest(bearer('errada')))).toBe('denied')
    expect(authorizeExport(exportRequest(bearer('senha-do-servidor')))).toBe(
      'allowed',
    )
    expect(
      authorizeExport(
        exportRequest({ authorization: 'bearer   senha-do-servidor ' }),
      ),
    ).toBe('allowed')
  })

  test('the session cookie and Basic auth do not count', () => {
    process.env.APP_PASSWORD = 'senha-do-servidor'
    const { token } = createSession(db)
    expect(
      authorizeExport(exportRequest({ cookie: `${SESSION_COOKIE}=${token}` })),
    ).toBe('denied')
    expect(
      authorizeExport(
        exportRequest({ authorization: `Basic ${btoa(':senha-do-servidor')}` }),
      ),
    ).toBe('denied')
  })

  test('accepts a secret with accents, sent as UTF-8 or Latin-1', () => {
    process.env.APP_PASSWORD = 'chácara-água'
    const utf8Bytes = Buffer.from('chácara-água', 'utf8').toString('latin1')
    expect(authorizeExport(exportRequest(bearer(utf8Bytes)))).toBe('allowed')
    expect(authorizeExport(exportRequest(bearer('chácara-água')))).toBe(
      'allowed',
    )
  })

  test('wrong secrets go through the brake', () => {
    process.env.APP_PASSWORD = 'senha-do-servidor'
    for (let i = 0; i < 10; i++) {
      expect(authorizeExport(exportRequest(bearer(`errada-${i}`)))).toBe(
        'denied',
      )
    }
    expect(authorizeExport(exportRequest(bearer('senha-do-servidor')))).toBe(
      'throttled',
    )
  })

  test('reads the bearer token', () => {
    expect(bearerToken(exportRequest(bearer('abc')))).toBe('abc')
    expect(bearerToken(exportRequest({ authorization: 'Bearer ' }))).toBeNull()
    expect(
      bearerToken(exportRequest({ authorization: 'Token abc' })),
    ).toBeNull()
    expect(bearerToken(exportRequest())).toBeNull()
  })
})
