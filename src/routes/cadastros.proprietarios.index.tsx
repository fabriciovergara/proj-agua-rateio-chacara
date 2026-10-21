import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { z } from 'zod'
import { EmptyState } from '#/components/page'
import { SearchBox } from '#/components/registry/search-box'
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
import { listOwners } from '#/server/owners.functions'

export const Route = createFileRoute('/cadastros/proprietarios/')({
  validateSearch: z.object({ busca: z.string().optional().catch(undefined) }),
  loader: () => listOwners(),
  head: () => ({ meta: [{ title: 'Proprietários — Rateio da Água' }] }),
  component: OwnersList,
})

function OwnersList() {
  const owners = Route.useLoaderData()
  const { busca = '' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const shown = owners.filter((owner) =>
    matchesSearch(busca, [
      owner.name,
      owner.document,
      owner.phone,
      owner.email,
      owner.notes,
      ...owner.properties.map((property) => property.name),
    ]),
  )

  if (owners.length === 0) {
    return (
      <EmptyState
        title="Nenhum proprietário cadastrado"
        action={
          <Button asChild>
            <Link to="/cadastros/proprietarios/novo">
              <Plus aria-hidden="true" />
              Cadastrar proprietário
            </Link>
          </Button>
        }
      >
        Cadastre os proprietários para ligá-los às chácaras e enviar as
        cobranças.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SearchBox
          label="Buscar proprietários"
          placeholder="Buscar por nome, documento, contato ou chácara"
          value={busca}
          onChange={(value) =>
            navigate({ search: { busca: value || undefined }, replace: true })
          }
        />
        <Button size="lg" asChild>
          <Link to="/cadastros/proprietarios/novo">
            <Plus aria-hidden="true" />
            Cadastrar proprietário
          </Link>
        </Button>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Chácaras</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((owner) => (
              <TableRow
                key={owner.id}
                className="cursor-pointer"
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('a,button')) return
                  navigate({
                    to: '/cadastros/proprietarios/$id',
                    params: { id: String(owner.id) },
                  })
                }}
              >
                <TableCell>
                  <Link
                    to="/cadastros/proprietarios/$id"
                    params={{ id: String(owner.id) }}
                    className="font-bold hover:underline"
                  >
                    {owner.name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">
                  {owner.document ?? '—'}
                </TableCell>
                <TableCell className="tabular-nums">
                  {owner.phone ?? '—'}
                </TableCell>
                <TableCell>{owner.email ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">
                  {owner.properties.length
                    ? owner.properties
                        .map((property) => property.name)
                        .join(', ')
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-muted-foreground">
                  Nenhum proprietário encontrado para “{busca}”.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
