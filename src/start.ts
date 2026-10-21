import { redirect } from '@tanstack/react-router'
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { getDb } from '#/db/client.server'
import { isUnlocked, lockStatus, safeReturnPath } from '#/server/auth.server'

/*
 * Nothing is served while the app is locked, in two layers:
 *  - every page and /api route request passes `lockGate`;
 *  - every server function (the only way data reaches the browser) passes
 *    `requireUnlocked`, whether called from a page render or over HTTP.
 */

/** Reachable while locked: the unlock page, its form and "Sair". */
const PUBLIC_PATHS = new Set([
  '/desbloquear',
  '/api/desbloquear',
  '/api/bloquear',
])

/**
 * The backup download for scripts checks its own secret (APP_PASSWORD in the
 * Authorization header) and ignores the session cookie, so neither the lock
 * nor the CSRF check apply to it.
 */
const EXPORT_PATH = '/api/exportar'

function noStoreRedirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  })
}

/** With a password, everything the server sends is private: never cache it. */
async function privateResponse<T extends { response: Response }>(
  pending: T | Promise<T>,
): Promise<T> {
  const result = await pending
  try {
    result.response.headers.set('Cache-Control', 'private, no-store')
  } catch {
    // Immutable headers (Response.redirect): there is no data to cache.
  }
  return result
}

const lockGate = createMiddleware({ type: 'request' }).server(
  ({ request, pathname, next, handlerType }) => {
    if (pathname === EXPORT_PATH) return next()

    const db = getDb()
    const { locked } = lockStatus(db)

    // Server functions answer with a redirect of their own (see below).
    if (handlerType === 'serverFn') {
      return locked ? privateResponse(next()) : next()
    }

    const unlocked = !locked || isUnlocked(db, request)
    const url = new URL(request.url)

    // Already unlocked (or no password at all): skip the unlock page.
    if (pathname === '/desbloquear' && unlocked) {
      return noStoreRedirect(safeReturnPath(url.searchParams.get('voltar')))
    }
    if (!locked || PUBLIC_PATHS.has(pathname)) return next()
    if (unlocked) return privateResponse(next())

    if (pathname.startsWith('/api/')) {
      return new Response('Desbloqueie o app para continuar.', {
        status: 401,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    const back = safeReturnPath(pathname + url.search)
    return noStoreRedirect(
      back === '/'
        ? '/desbloquear'
        : `/desbloquear?voltar=${encodeURIComponent(back)}`,
    )
  },
)

const requireUnlocked = createMiddleware({ type: 'function' }).server(
  ({ next }) => {
    if (!isUnlocked(getDb(), getRequest())) {
      throw redirect({ to: '/desbloquear' })
    }
    return next()
  },
)

/**
 * Defining a start instance replaces Start's default CSRF protection (server
 * functions only). Keep it, and also cover every /api route (a link on
 * another site must not start the backup download) and anything that isn't
 * a plain page read, like the unlock and lock forms.
 */
const csrf = createCsrfMiddleware({
  filter: (ctx) =>
    ctx.pathname !== EXPORT_PATH &&
    (ctx.handlerType === 'serverFn' ||
      ctx.pathname.startsWith('/api/') ||
      !['GET', 'HEAD'].includes(ctx.request.method)),
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf, lockGate],
  functionMiddleware: [requireUnlocked],
}))
