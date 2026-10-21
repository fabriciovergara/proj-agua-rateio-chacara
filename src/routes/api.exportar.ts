import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '#/db/client.server'
import { authorizeExport } from '#/server/auth.server'
import { backupResponse } from '#/server/backup.server'

/**
 * The whole database for scheduled backups — for scripts, not people:
 *
 *   curl -fsS -H "Authorization: Bearer $APP_PASSWORD" \
 *     -o rateio.sqlite https://…/api/exportar
 *
 * Same file as "Baixar cópia dos dados" in Configurações. It checks its own
 * secret, so the lock and the CSRF check skip it (see src/start.ts).
 */
export const Route = createFileRoute('/api/exportar')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        switch (authorizeExport(request)) {
          case 'disabled':
            return plain(
              404,
              'Exportação desativada: defina APP_PASSWORD no servidor.',
            )
          case 'throttled':
            return plain(
              429,
              'Muitas tentativas erradas. Espere 15 minutos e tente de novo.',
              { 'Retry-After': '900' },
            )
          case 'denied':
            await Bun.sleep(700)
            return plain(
              401,
              'Envie APP_PASSWORD no cabeçalho "Authorization: Bearer".',
              { 'WWW-Authenticate': 'Bearer realm="rateio"' },
            )
          case 'allowed':
            return backupResponse(getDb())
        }
      },
    },
  },
})

function plain(
  status: number,
  message: string,
  headers: Record<string, string> = {},
) {
  return new Response(`${message}\n`, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}
