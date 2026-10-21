import { asc, count, eq } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import { owners, properties, readings } from '#/db/schema'
import { UserFacingError } from '#/lib/errors'
import type { PropertyInput } from '#/lib/schemas'
import { propertySchema } from '#/lib/schemas'

const ownerColumns = {
  id: owners.id,
  name: owners.name,
  document: owners.document,
  phone: owners.phone,
  email: owners.email,
}

export function listProperties(db: Executor) {
  const rows = db
    .select({ property: properties, owner: ownerColumns })
    .from(properties)
    .leftJoin(owners, eq(owners.id, properties.ownerId))
    .orderBy(asc(properties.name))
    .all()

  const counts = new Map(
    db
      .select({ propertyId: readings.propertyId, total: count() })
      .from(readings)
      .groupBy(readings.propertyId)
      .all()
      .map((row) => [row.propertyId, row.total]),
  )

  return rows.map(({ property, owner }) => ({
    ...property,
    owner,
    readingCount: counts.get(property.id) ?? 0,
  }))
}

export function getProperty(db: Executor, id: number) {
  const row = db
    .select({ property: properties, owner: ownerColumns })
    .from(properties)
    .leftJoin(owners, eq(owners.id, properties.ownerId))
    .where(eq(properties.id, id))
    .get()
  if (!row) return null

  const readingCount =
    db
      .select({ total: count() })
      .from(readings)
      .where(eq(readings.propertyId, id))
      .get()?.total ?? 0

  return { ...row.property, owner: row.owner, readingCount }
}

function assertOwnerExists(db: Executor, ownerId: number | null) {
  if (ownerId === null) return
  const owner = db
    .select({ id: owners.id })
    .from(owners)
    .where(eq(owners.id, ownerId))
    .get()
  if (!owner) throw new UserFacingError('Proprietário não encontrado.')
}

export function createProperty(db: Executor, input: PropertyInput) {
  const values = propertySchema.parse(input)
  assertOwnerExists(db, values.ownerId)
  return db.insert(properties).values(values).returning().get()
}

export function updateProperty(db: Executor, id: number, input: PropertyInput) {
  const values = propertySchema.parse(input)
  assertOwnerExists(db, values.ownerId)
  const updated = db
    .update(properties)
    .set(values)
    .where(eq(properties.id, id))
    .returning()
    .get()
  if (!updated) throw new UserFacingError('Chácara não encontrada.')
  return updated
}

/** Deleting a chácara also deletes its readings (see the confirmation dialog). */
export function deleteProperty(db: Executor, id: number) {
  db.delete(properties).where(eq(properties.id, id)).run()
}
