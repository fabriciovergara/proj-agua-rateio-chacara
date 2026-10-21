import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { FileText, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { SectionTitle } from '#/components/page'
import { PropertyPlate } from '#/components/property-plate'
import { OwnerForm, ownerToForm } from '#/components/registry/owner-form'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { parseId } from '#/lib/route-params'
import { useAction } from '#/lib/use-action'
import { deleteOwner, getOwner, updateOwner } from '#/server/owners.functions'

export const Route = createFileRoute('/cadastros/proprietarios/$id')({
  loader: ({ params }) => getOwner({ data: { id: parseId(params.id) } }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.name ?? 'Proprietário'} — Rateio da Água` }],
  }),
  component: EditOwner,
})

function EditOwner() {
  const owner = Route.useLoaderData()
  const navigate = useNavigate()
  const update = useAction(updateOwner, {
    success: (saved) => `Dados de ${saved.name} atualizados.`,
  })
  const remove = useAction(deleteOwner, { success: 'Proprietário apagado.' })

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle className="mb-0">{owner.name}</SectionTitle>
        {owner.properties.length > 0 && (
          <Button variant="outline" asChild>
            <Link to="/relatorios/anual" search={{ proprietario: owner.id }}>
              <FileText aria-hidden="true" />
              Relatório anual
            </Link>
          </Button>
        )}
      </div>
      <OwnerForm
        key={owner.id}
        initial={ownerToForm(owner)}
        submitLabel="Salvar alterações"
        pending={update.pending}
        onSubmit={async (values) => {
          const saved = await update.run({ data: { id: owner.id, values } })
          if (saved) navigate({ to: '/cadastros/proprietarios' })
        }}
        aside={
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Chácaras</CardTitle>
              {owner.properties.length === 0 && (
                <CardDescription className="text-base">
                  Nenhuma chácara ligada. Para ligar, abra a chácara em
                  Cadastros e escolha este proprietário.
                </CardDescription>
              )}
            </CardHeader>
            {owner.properties.length > 0 && (
              <CardContent>
                <ul className="flex flex-wrap gap-3">
                  {owner.properties.map((property) => (
                    <li key={property.id}>
                      <Button
                        variant="outline"
                        asChild
                        className="h-auto py-2 text-base"
                      >
                        <Link
                          to="/chacaras/$id"
                          params={{ id: String(property.id) }}
                        >
                          <PropertyPlate name={property.name} size="sm" />
                          {property.name}
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>
        }
        footer={
          <ConfirmDialog
            title={`Apagar ${owner.name}?`}
            description={
              <>
                {owner.properties.length > 0 && (
                  <p>
                    <strong>
                      {owner.properties.map((p) => p.name).join(', ')}{' '}
                      {owner.properties.length === 1 ? 'ficará' : 'ficarão'} sem
                      proprietário.
                    </strong>{' '}
                    As leituras e cobranças continuam guardadas.
                  </p>
                )}
                <p>Esta ação não pode ser desfeita.</p>
              </>
            }
            confirmLabel="Apagar proprietário"
            onConfirm={async () => {
              const result = await remove.run({ data: { id: owner.id } })
              if (result) navigate({ to: '/cadastros/proprietarios' })
            }}
            trigger={
              <Button
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={remove.pending}
              >
                <Trash2 aria-hidden="true" />
                Apagar proprietário
              </Button>
            }
          />
        }
      />
    </div>
  )
}
