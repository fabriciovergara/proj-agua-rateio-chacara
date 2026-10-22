import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '#/db/client.server'
import {
  clientKey,
  createSession,
  forgiveAttempt,
  matchPassword,
  SESSION_COOKIE,
  safeReturnPath,
  serializeCookie,
  sessionCookieOptions,
  takeAttempt,
} from '#/server/auth.server'

/**
 * Target of the unlock form (a plain HTML form, so it works even before the
 * page's JavaScript loads). Answers with a redirect either way.
 */
export const Route = createFileRoute('/api/desbloquear')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData().catch(() => new FormData())
        const password = String(form.get('senha') ?? '').slice(0, 200)
        const back = safeReturnPath(String(form.get('voltar') ?? ''))
        const key = clientKey(request)

        const retry = (erro: 'senha' | 'tentativas') =>
          new Response(null, {
            status: 303,
            headers: {
              Location:
                `/desbloquear?erro=${erro}` +
                (back === '/' ? '' : `&voltar=${encodeURIComponent(back)}`),
              'Cache-Control': 'no-store',
            },
          })

        if (!takeAttempt(key)) return retry('tentativas')

        const db = getDb()
        const matched = await matchPassword(db, password)
        if (!matched) {
          await Bun.sleep(700)
          return retry('senha')
        }

        forgiveAttempt(key)
        const { token, maxAge } = createSession(db, {
          withEnvPassword: matched === 'env',
        })
        return new Response(null, {
          status: 303,
          headers: {
            Location: back,
            'Set-Cookie': serializeCookie(
              SESSION_COOKIE,
              token,
              sessionCookieOptions(request, maxAge),
            ),
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
