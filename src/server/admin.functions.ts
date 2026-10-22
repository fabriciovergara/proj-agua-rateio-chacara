import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { getDb } from '#/db/client.server'
import { UserFacingError } from '#/lib/errors'
import * as auth from './auth.server'
import { importBackup, isSqliteFile, readBackup } from './backup.server'
import { deleteAllData } from './data.server'
import { importLegacy, readLegacyZip } from './legacy.server'

/*
 * Configurações options for whoever runs the server: importing data and
 * wiping it all. Only a browser unlocked with APP_PASSWORD sees them, and
 * the server refuses them to any other before looking at what it sent.
 */
const requireEnvPassword = createMiddleware({ type: 'function' }).server(
  ({ next }) => {
    if (!auth.isUnlockedWithEnvPassword(getDb(), getRequest())) {
      throw new UserFacingError(
        'Só quem entrou com a senha do servidor pode fazer isso.',
      )
    }
    return next()
  },
)

/** Backups have a few hundred KB, the old app's .zip well under 1 MB. */
const MAX_FILE_BYTES = 20 * 1024 * 1024

/** Every .zip starts with "PK". */
const isZipFile = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b

/**
 * "Importar dados": a backup made by "Cópia de segurança" or the .zip with
 * the CSVs of the old Access app. Either way only what the app doesn't have
 * yet comes in.
 */
export const importData = createServerFn({ method: 'POST' })
  .middleware([requireEnvPassword])
  .validator((data: unknown) => {
    const file = data instanceof FormData ? data.get('arquivo') : null
    if (!(file instanceof File) || file.size === 0) {
      throw new UserFacingError(
        'Escolha o arquivo: a cópia de segurança ou o .zip do sistema antigo.',
      )
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new UserFacingError('O arquivo é grande demais (até 20 MB).')
    }
    return file
  })
  .handler(async ({ data }) => {
    const bytes = new Uint8Array(await data.arrayBuffer())
    if (isSqliteFile(bytes)) {
      return {
        from: 'backup' as const,
        ...importBackup(getDb(), readBackup(bytes)),
      }
    }
    if (isZipFile(bytes)) {
      return {
        from: 'legacy' as const,
        ...importLegacy(getDb(), readLegacyZip(bytes)),
      }
    }
    throw new UserFacingError(
      'Este arquivo não é uma cópia de segurança nem o .zip do sistema antigo.',
    )
  })

/** "Apagar todos os dados", confirmed by typing APP_PASSWORD again. */
export const wipeAllData = createServerFn({ method: 'POST' })
  .middleware([requireEnvPassword])
  .validator(z.object({ password: z.string().max(200) }))
  .handler(async ({ data }) => {
    const db = getDb()
    await auth.withPasswordBrake(getRequest(), () =>
      auth.confirmEnvPassword(db, data.password),
    )
    deleteAllData(db)
    return { ok: true as const }
  })
