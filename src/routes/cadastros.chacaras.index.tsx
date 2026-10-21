import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Gauge, Plus } from 'lucide-react'
import { z } from 'zod'
import { EmptyState } from '#/components/page'
import { PropertyPlate } from '#/components/property-plate'
import { SearchBox } from '#/components/registry/search-box'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { matchesSearch } from '#/lib/masks'
import { listProperties } from '#/server/properties.functions'

export const Route = createFileRoute('/cadastros/chacaras/')({
  validateSearch: z.object({ busca: z.string().optional().catch(undefined) }),
  loader: () => listProperties(),
  head: () => ({ meta: [{ title: 'Chácaras — Rateio da Água' }] }),
  component: PropertiesList,
})

function PropertiesList() {
  const properties = Route.useLoaderData()
  const { busca = '' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const shown = properties.filter((property) =>
    matchesSearch(busca, [
      property.name,
      property.meterNumber,
      property.owner?.name,
      property.street,
      property.number,
      property.district,
      property.city,
      property.state,
      property.zipCode,
      property.notes,
    ]),
  )

  if (properties.length === 0) {
    return (
      <EmptyState
        title="Nenhuma chácara cadastrada"
        action={
          <Button asChild>
            <Link to="/cadastros/chacaras/nova">
              <Plus aria-hidden="true" />
              Cadastrar chácara
            </Link>
          </Button>
        }
      >
        Cadastre cada chácara com o número do hidrômetro e o proprietário.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SearchBox
          label="Buscar chácaras"
          placeholder="Buscar por nome, proprietário, hidrômetro ou endereço"
          value={busca}
          onChange={(value) =>
            navigate({ search: { busca: value || undefined }, replace: true })
          }
        />
        <Button size="lg" asChild>
          <Link to="/cadastros/chacaras/nova">
            <Plus aria-hidden="true" />
            Cadastrar chácara
          </Link>
        </Button>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Chácara</TableHead>
              <TableHead>Proprietário</TableHead>
              <TableHead>Hidrômetro</TableHead>
              <TableHead>Endereço</TableHead>
              <TableHead className="text-right">Leituras</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((property) => (
              <TableRow
                key={property.id}
                className="cursor-pointer"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('a,button')) return
                  navigate({
                    to: '/cadastros/chacaras/$id',
                    params: { id: String(property.id) },
                  })
                }}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <PropertyPlate name={property.name} />
                    <Link
                      to="/cadastros/chacaras/$id"
                      params={{ id: String(property.id) }}
                      className="font-bold hover:underline"
                    >
                      {property.name}
                    </Link>
                  </div>
                </TableCell>
                <TableCell>
                  {property.owner?.name ?? (
                    <span className="text-muted-foreground">
                      Sem proprietário
                    </span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {property.meterNumber ?? '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {[
                    [property.street, property.number]
                      .filter(Boolean)
                      .join(', '),
                    [property.city, property.state].filter(Boolean).join('/'),
                  ]
                    .filter(Boolean)
                    .join(' — ') || '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {property.readingCount}
                </TableCell>
                <TableCell>
                  {property.active ? (
                    <Badge variant="secondary">Ativa</Badge>
                  ) : (
                    <Badge variant="pending">Inativa</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" asChild>
                    <Link
                      to="/chacaras/$id"
                      params={{ id: String(property.id) }}
                    >
                      <Gauge aria-hidden="true" />
                      Leituras
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-muted-foreground">
                  Nenhuma chácara encontrada para “{busca}”.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
