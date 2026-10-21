/**
 * Production server: serves the built client assets and hands every other
 * request to TanStack Start. Run `bun run build` first, then `bun run start`.
 *
 *   PORT=3000 DATABASE_PATH=data/rateio.sqlite bun run start
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

const clientDir = path.resolve(import.meta.dir, 'dist/client')
const serverEntry = path.resolve(import.meta.dir, 'dist/server/server.js')
const port = Number(process.env.PORT ?? 3000)

if (!existsSync(serverEntry)) {
  console.error('O app ainda não foi compilado. Rode "bun run build" antes.')
  process.exit(1)
}

const { default: handler } = (await import(serverEntry)) as {
  default: { fetch: (request: Request) => Response | Promise<Response> }
}

const COMPRESSIBLE = /text\/|javascript|json|svg|xml/

/** Gzip text responses: pages are mostly HTML tables and open on phones too. */
async function compress(request: Request, response: Response) {
  const type = response.headers.get('content-type') ?? ''
  if (
    !COMPRESSIBLE.test(type) ||
    response.headers.has('content-encoding') ||
    !request.headers.get('accept-encoding')?.includes('gzip')
  ) {
    return response
  }
  const body = Bun.gzipSync(new Uint8Array(await response.arrayBuffer()))
  const headers = new Headers(response.headers)
  headers.set('content-encoding', 'gzip')
  headers.delete('content-length')
  headers.append('vary', 'accept-encoding')
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function staticFile(pathname: string) {
  const filePath = path.join(clientDir, decodeURIComponent(pathname))
  // Never serve files outside dist/client (e.g. "/../../data/rateio.sqlite").
  if (!filePath.startsWith(clientDir + path.sep)) return null
  const file = Bun.file(filePath)
  if (!(await file.exists())) return null
  return new Response(file, {
    headers: {
      'Content-Type': file.type,
      'Cache-Control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
    },
  })
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url)
    const response =
      (pathname !== '/' && (await staticFile(pathname))) ||
      (await handler.fetch(request))
    return compress(request, response)
  },
})

console.log(`Rateio da Água rodando em ${server.url}`)
