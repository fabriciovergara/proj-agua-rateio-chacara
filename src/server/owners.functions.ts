import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb } from '#/db/client.server'
import { idSchema, ownerSchema } from '#/lib/schemas'
import * as repo from './owners.server'

export const listOwners = createServerFn({ method: 'GET' }).handler(() =>
  repo.listOwners(getDb()),
)

export const getOwner = createServerFn({ method: 'GET' })
  .validator(z.object({ id: idSchema }))
  .handler(({ data }) => {
    const owner = repo.getOwner(getDb(), data.id)
    if (!owner) throw notFound()
    return owner
  })

export const createOwner = createServerFn({ method: 'POST' })
  .validator(ownerSchema)
  .handler(({ data }) => repo.createOwner(getDb(), data))

export const updateOwner = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema, values: ownerSchema }))
  .handler(({ data }) => repo.updateOwner(getDb(), data.id, data.values))

export const deleteOwner = createServerFn({ method: 'POST' })
  .validator(z.object({ id: idSchema }))
  .handler(({ data }) => {
    repo.deleteOwner(getDb(), data.id)
    return { ok: true as const }
  })
