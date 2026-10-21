import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DB } from '#/db/client.server'
import { todayISO } from '#/lib/periods'

/**
 * A consistent copy of the whole database (VACUUM INTO works while the app
 * is running). Restoring is replacing data/rateio.sqlite with this file.
 * The app password stays (a restore must not remove it); the sessions of
 * unlocked devices are left out.
 */
export async function createBackup(db: DB): Promise<ArrayBuffer> {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rateio-backup-'))
  const file = path.join(directory, 'rateio.sqlite')
  try {
    db.$client.run('VACUUM INTO ?', [file])
    const copy = new Database(file)
    try {
      copy.run('DELETE FROM sessions')
      copy.run('VACUUM')
    } finally {
      copy.close()
    }
    return await Bun.file(file).arrayBuffer()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** The backup as a file download (Configurações and /api/exportar). */
export async function backupResponse(db: DB): Promise<Response> {
  return new Response(await createBackup(db), {
    headers: {
      'Content-Type': 'application/vnd.sqlite3',
      'Content-Disposition': `attachment; filename="rateio-da-agua-${todayISO()}.sqlite"`,
      'Cache-Control': 'no-store',
    },
  })
}
