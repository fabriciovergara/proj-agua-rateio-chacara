import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '#/db/client.server'
import { backupResponse } from '#/server/backup.server'

/** Downloads a copy of the database ("Cópia de segurança" in Configurações). */
export const Route = createFileRoute('/api/backup')({
  server: {
    handlers: {
      GET: () => backupResponse(getDb()),
    },
  },
})
