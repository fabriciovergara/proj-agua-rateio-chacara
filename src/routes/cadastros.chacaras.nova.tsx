import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SectionTitle } from '#/components/page'
import {
  emptyProperty,
  PropertyForm,
} from '#/components/registry/property-form'
import { useAction } from '#/lib/use-action'
import { createProperty, getPropertyForm } from '#/server/properties.functions'

export const Route = createFileRoute('/cadastros/chacaras/nova')({
  loader: () => getPropertyForm({ data: {} }),
  head: () => ({ meta: [{ title: 'Nova chácara — Rateio da Água' }] }),
  component: NewProperty,
})

function NewProperty() {
  const { owners } = Route.useLoaderData()
  const navigate = useNavigate()
  const create = useAction(createProperty, {
    success: (property) => `${property.name} cadastrada.`,
  })

  return (
    <div className="max-w-4xl">
      <SectionTitle>Nova chácara</SectionTitle>
      <PropertyForm
        initial={emptyProperty}
        owners={owners}
        submitLabel="Cadastrar chácara"
        pending={create.pending}
        onSubmit={async (values) => {
          const property = await create.run({ data: values })
          if (property) navigate({ to: '/cadastros/chacaras' })
        }}
      />
    </div>
  )
}
