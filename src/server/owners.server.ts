import { asc, eq } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import { owners, properties } from '#/db/schema'
import { UserFacingError } from '#/lib/errors'
import type { OwnerInput } from '#/lib/schemas'
import { ownerSchema } from '#/lib/schemas'

export function listOwners(db: Executor) {
  const allOwners = db.select().from(owners).orderBy(asc(owners.name)).all()
  const owned = db
    .select({
      id: properties.id,
      name: properties.name,
      ownerId: properties.ownerId,
    })
    .from(properties)
    .orderBy(asc(properties.name))
    .all()

  return allOwners.map((owner) => ({
    ...owner,
    properties: owned
      .filter((property) => property.ownerId === owner.id)
      .map(({ id, name }) => ({ id, name })),
  }))
}

export function getOwner(db: Executor, id: number) {
  const owner = db.select().from(owners).where(eq(owners.id, id)).get()
  if (!owner) return null
  const ownedProperties = db
    .select({ id: properties.id, name: properties.name })
    .from(properties)
    .where(eq(properties.ownerId, id))
    .orderBy(asc(properties.name))
    .all()
  return { ...owner, properties: ownedProperties }
}

export function createOwner(db: Executor, input: OwnerInput) {
  const values = ownerSchema.parse(input)
  return db.insert(owners).values(values).returning().get()
}

export function updateOwner(db: Executor, id: number, input: OwnerInput) {
  const values = ownerSchema.parse(input)
  const updated = db
    .update(owners)
    .set(values)
    .where(eq(owners.id, id))
    .returning()
    .get()
  if (!updated) throw new UserFacingError('Proprietário não encontrado.')
  return updated
}

/** Chácaras of a deleted owner stay registered, just without an owner. */
export function deleteOwner(db: Executor, id: number) {
  db.delete(owners).where(eq(owners.id, id)).run()
}
