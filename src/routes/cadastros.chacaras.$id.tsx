import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Gauge, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { SectionTitle } from '#/components/page'
import {
  PropertyForm,
  propertyToForm,
} from '#/components/registry/property-form'
import { Button } from '#/components/ui/button'
import { parseId } from '#/lib/route-params'
import { useAction } from '#/lib/use-action'
import {
  deleteProperty,
  getPropertyForm,
  updateProperty,
} from '#/server/properties.functions'

export const Route = createFileRoute('/cadastros/chacaras/$id')({
  loader: ({ params }) => getPropertyForm({ data: { id: parseId(params.id) } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.property?.name ?? 'Chácara'} — Rateio da Água`,
      },
    ],
  }),
  component: EditProperty,
})

function EditProperty() {
  const { property, owners } = Route.useLoaderData()
  const navigate = useNavigate()
  const update = useAction(updateProperty, {
    success: (saved) => `${saved.name} atualizada.`,
  })
  const remove = useAction(deleteProperty, { success: 'Chácara apagada.' })

  if (!property) return null
  const readings = property.readingCount

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle className="mb-0">{property.name}</SectionTitle>
        <Button variant="outline" asChild>
          <Link to="/chacaras/$id" params={{ id: String(property.id) }}>
            <Gauge aria-hidden="true" />
            Ver leituras
          </Link>
        </Button>
      </div>
      <PropertyForm
        key={property.id}
        initial={propertyToForm(property)}
        owners={owners}
        submitLabel="Salvar alterações"
        pending={update.pending}
        onSubmit={async (values) => {
          const saved = await update.run({ data: { id: property.id, values } })
          if (saved) navigate({ to: '/cadastros/chacaras' })
        }}
        footer={
          <ConfirmDialog
            title={`Apagar ${property.name}?`}
            description={
              <>
                {readings > 0 && (
                  <p>
                    <strong>
                      {readings === 1
                        ? 'A leitura desta chácara também será apagada.'
                        : `As ${readings} leituras desta chácara também serão apagadas.`}
                    </strong>
                  </p>
                )}
                <p>
                  Se a chácara só deixou de usar a bomba, prefira desmarcar
                  “Chácara ativa”: o histórico continua guardado.
                </p>
              </>
            }
            confirmLabel="Apagar chácara"
            onConfirm={async () => {
              const result = await remove.run({ data: { id: property.id } })
              if (result) navigate({ to: '/cadastros/chacaras' })
            }}
            trigger={
              <Button
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={remove.pending}
              >
                <Trash2 aria-hidden="true" />
                Apagar chácara
              </Button>
            }
          />
        }
      />
    </div>
  )
}
