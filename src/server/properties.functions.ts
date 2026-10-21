import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb } from '#/db/client.server'
import { idSchema, propertySchema } from '#/lib/schemas'
import { listOwners } from './owners.server'
import * as repo from './properties.server'

export const listProperties = createServerFn({ method: 'GET' }).handler(() =>
  repo.listProperties(getDb()),
)

/** The chácara form: the chácara (when editing) and the owners to pick from. */
export const getPropertyForm = createServerFn({ method: 'GET' })
  .validator(z.object({ id: idSchema.optional() }))
  .handler(({ data }) => {
    const db = getDb()
    const owners = listOwners(db).map(({ id, name }) => ({ id, name }))
    if (data.id === undefined) return { property: null, owners }
    const property = repo.getProperty(db, data.id)
    if (!property) throw notFound()
    return { property, owners }
  })

export const createProperty = createServerFn({ method: 'POST' })
  .validator(propertySchema)
  .handler(({ data }) => repo.createProperty(getDb(), data))

export const updateProperty = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema, values: propertySchema }))
  .handler(({ data }) => repo.updateProperty(getDb(), data.id, data.values))

export const deleteProperty = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema }))
  .handler(({ data }) => {
    repo.deleteProperty(getDb(), data.id)
    return { ok: true as const }
  })
