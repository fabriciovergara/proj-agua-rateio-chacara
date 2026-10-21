import { useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from './errors'

// biome-ignore lint/suspicious/noExplicitAny: matches the shape of server functions
type ServerFn = (options: any) => Promise<any>

/**
 * Calls a server function from a button or form: tracks "saving…", shows the
 * error in a toast, and reloads the page data after it succeeds.
 */
export function useAction<T extends ServerFn>(
  serverFn: T,
  options: {
    success?: string | ((result: Awaited<ReturnType<T>>) => string | null)
    /** Reload route loaders afterwards (default: true). */
    invalidate?: boolean
    /** Show the error next to the field instead of in a toast. */
    onError?: (message: string) => void
  } = {},
) {
  const router = useRouter()
  const call = useServerFn(serverFn)
  const [pending, setPending] = useState(false)

  async function run(
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>> | undefined> {
    setPending(true)
    try {
      const result = await call(...args)
      if (options.invalidate !== false) await router.invalidate()
      const message =
        typeof options.success === 'function'
          ? options.success(result)
          : options.success
      if (message) toast.success(message)
      return result
    } catch (error) {
      const message = errorMessage(error)
      if (options.onError) options.onError(message)
      else toast.error(message)
      return undefined
    } finally {
      setPending(false)
    }
  }

  return { run, pending }
}
