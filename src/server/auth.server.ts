import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { eq, lt } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import { appPassword, sessions } from '#/db/schema'
import { MIN_PASSWORD_LENGTH } from '#/lib/domain'
import { UserFacingError } from '#/lib/errors'

/*
 * App lock. The app asks for a password when one is configured:
 *  - APP_PASSWORD in the server environment, and/or
 *  - a password set in Configurações (stored as an argon2id hash).
 * Either one unlocks. A successful unlock creates a session: a random token
 * in an HttpOnly cookie, stored server-side only as a SHA-256 hash. The
 * session remembers whether APP_PASSWORD opened it: only those browsers may
 * import data and wipe it all.
 */

export const SESSION_COOKIE = 'rateio_sessao'
const SESSION_DAYS = 60
const SINGLETON_ID = 1

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex')

export function envPassword(): string | null {
  return process.env.APP_PASSWORD?.trim() || null
}

function storedHash(db: Executor): string | null {
  return (
    db
      .select({ hash: appPassword.hash })
      .from(appPassword)
      .where(eq(appPassword.id, SINGLETON_ID))
      .get()?.hash ?? null
  )
}

/** Which passwords exist (never the passwords themselves). */
export function lockStatus(db: Executor) {
  const env = envPassword() !== null
  const app = storedHash(db) !== null
  return { envPassword: env, appPassword: app, locked: env || app }
}

/** Changes whenever any password changes, invalidating older sessions. */
function credentialsFingerprint(db: Executor): string {
  return sha256(`${sha256(envPassword() ?? '')}:${storedHash(db) ?? ''}`)
}

function equalsInConstantTime(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  )
}

/** APP_PASSWORD or the one set in Configurações. */
export type PasswordKind = 'env' | 'app'

/** Which password `candidate` is, if any (APP_PASSWORD wins a tie). */
export async function matchPassword(
  db: Executor,
  candidate: string,
): Promise<PasswordKind | null> {
  if (!candidate) return null
  const env = envPassword()
  if (env && equalsInConstantTime(candidate, env)) return 'env'
  const hash = storedHash(db)
  return hash && (await Bun.password.verify(candidate, hash)) ? 'app' : null
}

export function createSession(db: Executor, { withEnvPassword = false } = {}) {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  db.delete(sessions)
    .where(lt(sessions.expiresAt, new Date(now)))
    .run()
  db.insert(sessions)
    .values({
      tokenHash: sha256(token),
      credentials: credentialsFingerprint(db),
      withEnvPassword,
      expiresAt: new Date(now + SESSION_DAYS * 86_400_000),
    })
    .run()
  return { token, maxAge: SESSION_DAYS * 86_400 }
}

function validSession(db: Executor, token: string | undefined) {
  if (!token) return null
  const session = db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, sha256(token)))
    .get()
  return session !== undefined &&
    session.expiresAt.getTime() > Date.now() &&
    session.credentials === credentialsFingerprint(db)
    ? session
    : null
}

export function isValidSession(db: Executor, token: string | undefined) {
  return validSession(db, token) !== null
}

export function deleteSession(db: Executor, token: string | undefined) {
  if (token) {
    db.delete(sessions)
      .where(eq(sessions.tokenHash, sha256(token)))
      .run()
  }
}

export function readCookie(
  header: string | null | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key !== name) continue
    try {
      return decodeURIComponent(rest.join('='))
    } catch {
      return undefined // Malformed on purpose; never a valid session.
    }
  }
  return undefined
}

/** May this request see data? Yes without passwords, else with a session. */
export function isUnlocked(db: Executor, request: Request): boolean {
  if (!lockStatus(db).locked) return true
  return isValidSession(
    db,
    readCookie(request.headers.get('cookie'), SESSION_COOKIE),
  )
}

/**
 * Was this browser unlocked with APP_PASSWORD? Only then Configurações
 * imports data and wipes it all. Never without APP_PASSWORD, and a new
 * APP_PASSWORD ends these sessions like any other.
 */
export function isUnlockedWithEnvPassword(
  db: Executor,
  request: Request,
): boolean {
  if (envPassword() === null) return false
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  return validSession(db, token)?.withEnvPassword === true
}

export function isSecureRequest(request: Request): boolean {
  return (
    new URL(request.url).protocol === 'https:' ||
    request.headers.get('x-forwarded-proto') === 'https'
  )
}

export function sessionCookieOptions(request: Request, maxAge: number) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isSecureRequest(request),
    maxAge,
  }
}

export function serializeCookie(
  name: string,
  value: string,
  options: ReturnType<typeof sessionCookieOptions>,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    options.secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ')
}

/**
 * Only paths on this site, so `?voltar=` can't send people elsewhere. Parsed
 * the way browsers do, which also catches tricks like `/\\golpe.com`.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value?.startsWith('/')) return '/'
  const base = 'http://rateio.invalid'
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    return '/'
  }
  if (url.origin !== base) return '/'
  const path = url.pathname + url.search + url.hash
  if (path.startsWith('/desbloquear') || path.startsWith('/api/')) return '/'
  return path
}

/*
 * Brute-force brake, per 15 minutes: 10 password attempts per client and 30
 * in total. The client address comes from headers that can be forged when
 * there is no proxy in front, so the total is what really stops guessing.
 * An attempt is counted before the password is checked, so guesses sent all
 * at once can't slip through; a right password gives it back. Browsers
 * already unlocked are not affected.
 */
const WINDOW_MS = 15 * 60_000
const MAX_PER_CLIENT = 10
const MAX_TOTAL = 30
const EVERYONE = '*'
const attempts = new Map<string, { count: number; since: number }>()

/** The address the nearest proxy saw (it appends to X-Forwarded-For). */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',').at(-1)
  return (
    forwarded?.trim() || request.headers.get('x-real-ip')?.trim() || 'local'
  )
}

function attemptsOf(key: string, now: number) {
  const entry = attempts.get(key)
  return entry && now - entry.since <= WINDOW_MS ? entry : undefined
}

/** Counts one password attempt; false when the limit was already reached. */
export function takeAttempt(key: string, now = Date.now()): boolean {
  if (
    (attemptsOf(key, now)?.count ?? 0) >= MAX_PER_CLIENT ||
    (attemptsOf(EVERYONE, now)?.count ?? 0) >= MAX_TOTAL
  ) {
    return false
  }
  if (attempts.size > 1000) {
    for (const [stale, entry] of attempts) {
      if (now - entry.since > WINDOW_MS) attempts.delete(stale)
    }
  }
  for (const counted of [key, EVERYONE]) {
    const entry = attemptsOf(counted, now)
    if (entry) entry.count++
    else attempts.set(counted, { count: 1, since: now })
  }
  return true
}

/** After a right password: the client starts over and the total gets it back. */
export function forgiveAttempt(key: string, now = Date.now()) {
  attempts.delete(key)
  const total = attemptsOf(EVERYONE, now)
  if (total && total.count > 0) total.count--
}

/** For tests. */
export function resetAttempts() {
  attempts.clear()
}

/**
 * A password typed to confirm something, not to unlock, goes through the
 * same brake: `check` throws when it is wrong.
 */
export async function withPasswordBrake<T>(
  request: Request,
  check: () => Promise<T>,
): Promise<T> {
  const key = clientKey(request)
  if (!takeAttempt(key)) {
    throw new UserFacingError(
      'Muitas tentativas erradas. Espere 15 minutos e tente de novo.',
    )
  }
  const result = await check()
  forgiveAttempt(key)
  return result
}

/** The secret of `Authorization: Bearer <secret>`, as received. */
export function bearerToken(request: Request): string | null {
  const match = request.headers.get('authorization')?.match(/^Bearer +(.+)$/i)
  return match?.[1]?.trim() || null
}

function matchesEnvPassword(candidate: string, env: string): boolean {
  // Header values arrive byte by byte: a secret with accents sent as UTF-8
  // (curl does) only matches once decoded back.
  const utf8 = Buffer.from(candidate, 'latin1').toString('utf8')
  return equalsInConstantTime(candidate, env) || equalsInConstantTime(utf8, env)
}

/**
 * Access to /api/exportar, the backup download for scripts. They send
 * APP_PASSWORD as `Authorization: Bearer …`; the session cookie doesn't
 * count, so a page on another site can't trigger it. Without APP_PASSWORD
 * there is no export. Wrong secrets go through the brake above.
 */
export function authorizeExport(
  request: Request,
  now = Date.now(),
): 'disabled' | 'throttled' | 'denied' | 'allowed' {
  const env = envPassword()
  if (!env) return 'disabled'
  const key = clientKey(request)
  if (!takeAttempt(key, now)) return 'throttled'
  const token = bearerToken(request)
  if (!token || !matchesEnvPassword(token, env)) return 'denied'
  forgiveAttempt(key, now)
  return 'allowed'
}

async function requireCurrentPassword(
  db: Executor,
  current: string,
): Promise<PasswordKind> {
  const matched = await matchPassword(db, current)
  if (!matched) throw new UserFacingError('A senha atual está errada.')
  return matched
}

/** Wiping all the data asks for APP_PASSWORD itself, not just any password. */
export async function confirmEnvPassword(db: Executor, candidate: string) {
  if ((await matchPassword(db, candidate)) !== 'env') {
    throw new UserFacingError('A senha do servidor está errada.')
  }
}

/**
 * Sets the Configurações password. When the app is already locked the
 * current password (either one) is required; returns which one it was.
 * Signs every browser out.
 */
export async function setAppPassword(
  db: Executor,
  input: { current: string; password: string },
): Promise<PasswordKind | null> {
  const matched = lockStatus(db).locked
    ? await requireCurrentPassword(db, input.current)
    : null
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new UserFacingError(
      `Use pelo menos ${MIN_PASSWORD_LENGTH} letras ou números.`,
    )
  }
  const hash = await Bun.password.hash(input.password)
  db.insert(appPassword)
    .values({ id: SINGLETON_ID, hash })
    .onConflictDoUpdate({
      target: appPassword.id,
      set: { hash, updatedAt: new Date() },
    })
    .run()
  db.delete(sessions).run()
  return matched
}

/**
 * Removes the Configurações password (APP_PASSWORD, if set, still applies).
 * Returns which password confirmed it.
 */
export async function removeAppPassword(
  db: Executor,
  input: { current: string },
): Promise<PasswordKind> {
  const matched = await requireCurrentPassword(db, input.current)
  db.delete(appPassword).run()
  db.delete(sessions).run()
  return matched
}
