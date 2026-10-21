import { notFound } from '@tanstack/react-router'

/** Route params arrive as text; anything that is not a positive id is a 404. */
export function parseId(value: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound()
  return id
}
