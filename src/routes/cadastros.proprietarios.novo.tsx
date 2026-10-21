import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SectionTitle } from '#/components/page'
import { emptyOwner, OwnerForm } from '#/components/registry/owner-form'
import { useAction } from '#/lib/use-action'
import { createOwner } from '#/server/owners.functions'

export const Route = createFileRoute('/cadastros/proprietarios/novo')({
  head: () => ({ meta: [{ title: 'Novo proprietário — Rateio da Água' }] }),
  component: NewOwner,
})

function NewOwner() {
  const navigate = useNavigate()
  const create = useAction(createOwner, {
    success: (owner) => `${owner.name} cadastrado(a).`,
  })

  return (
    <div className="max-w-4xl">
      <SectionTitle>Novo proprietário</SectionTitle>
      <OwnerForm
        initial={emptyOwner}
        submitLabel="Cadastrar proprietário"
        pending={create.pending}
        onSubmit={async (values) => {
          const owner = await create.run({ data: values })
          if (owner) navigate({ to: '/cadastros/proprietarios' })
        }}
      />
    </div>
  )
}
