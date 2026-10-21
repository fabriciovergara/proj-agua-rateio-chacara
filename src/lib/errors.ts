/** An error whose message is safe and useful to show to the person using the app. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserFacingError'
  }
}

const FALLBACK = 'Não foi possível concluir. Tente novamente.'

/**
 * Turns anything thrown by a server function into a sentence for a toast.
 * Validation errors arrive as a JSON list of issues; we show the first one.
 */
export function errorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  if (!message) return FALLBACK

  if (message.trimStart().startsWith('[')) {
    try {
      const issues = JSON.parse(message) as Array<{ message?: string }>
      return issues[0]?.message ?? FALLBACK
    } catch {
      return FALLBACK
    }
  }
  return message
}

/** Translates SQLite constraint failures into plain Portuguese. */
export function translateDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('UNIQUE constraint failed: readings')) {
    throw new UserFacingError(
      'Já existe uma leitura deste mês para esta chácara.',
    )
  }
  if (message.includes('readings_consumption_non_negative')) {
    throw new UserFacingError(
      'A leitura atual não pode ser menor que a anterior.',
    )
  }
  throw error
}
