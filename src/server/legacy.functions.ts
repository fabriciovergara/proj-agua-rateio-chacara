import { createServerFn } from '@tanstack/react-start'
import { getDb } from '#/db/client.server'
import { UserFacingError } from '#/lib/errors'
import { importLegacy, readLegacyZip } from './legacy.server'

/** The real export zips to well under 1 MB, Kw.mdb included. */
const MAX_ZIP_BYTES = 20 * 1024 * 1024

/**
 * "Dados do sistema antigo" in Configurações: the .zip with the CSVs of the
 * old Access app fills in the history that isn't in the app yet.
 */
export const importLegacyZip = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const file = data instanceof FormData ? data.get('arquivo') : null
    if (!(file instanceof File) || file.size === 0) {
      throw new UserFacingError('Escolha o arquivo .zip do sistema antigo.')
    }
    if (file.size > MAX_ZIP_BYTES) {
      throw new UserFacingError('O arquivo é grande demais (até 20 MB).')
    }
    return file
  })
  .handler(async ({ data }) =>
    importLegacy(
      getDb(),
      readLegacyZip(new Uint8Array(await data.arrayBuffer())),
    ),
  )
