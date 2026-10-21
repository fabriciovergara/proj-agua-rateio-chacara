import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '#/db/client.server'
import {
  deleteSession,
  readCookie,
  SESSION_COOKIE,
  serializeCookie,
  sessionCookieOptions,
} from '#/server/auth.server'

/** "Sair deste aparelho": ends this browser's session. */
export const Route = createFileRoute('/api/bloquear')({
  server: {
    handlers: {
      POST: ({ request }) => {
        deleteSession(
          getDb(),
          readCookie(request.headers.get('cookie'), SESSION_COOKIE),
        )
        return new Response(null, {
          status: 303,
          headers: {
            Location: '/desbloquear',
            'Set-Cookie': serializeCookie(
              SESSION_COOKIE,
              '',
              sessionCookieOptions(request, 0),
            ),
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
