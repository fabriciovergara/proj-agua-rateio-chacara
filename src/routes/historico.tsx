import { createFileRoute, Link } from '@tanstack/react-router'
import { Download, FileText } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { FilterSelect } from '#/components/filter-select'
import { EmptyState, PageHeader } from '#/components/page'
import { PropertyPlate } from '#/components/property-plate'
import { PaidToggle } from '#/components/readings/paid-toggle'
import { StatusBadge } from '#/components/status-badge'
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
import { centsToCsv, downloadCsv, microsToCsv, toCsv } from '#/lib/csv'
import { formatBRL, formatNumber } from '#/lib/money'
import { formatDate, formatPeriodShort, MONTH_NAMES } from '#/lib/periods'
import { getHistory } from '#/server/readings.functions'
import { getReportOptions } from '#/server/reports.functions'

const PAGE_SIZE = 120

export const Route = createFileRoute('/historico')({
  validateSearch: z.object({
    chacara: z.number().int().positive().optional().catch(undefined),
    ano: z.number().int().min(2000).max(2100).optional().catch(undefined),
    situacao: z.enum(['pago', 'pendente']).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [options, history] = await Promise.all([
      getReportOptions(),
      getHistory({
        data: {
          propertyId: deps.chacara,
          year: deps.ano,
          status: deps.situacao,
        },
      }),
    ])
    return { options, history }
  },
  head: () => ({ meta: [{ title: 'Histórico — Rateio da Água' }] }),
  component: HistoryPage,
})

type HistoryRow = Awaited<ReturnType<typeof getHistory>>['rows'][number]

function exportCsv(rows: HistoryRow[]) {
  const header = [
    'Ano',
    'Mês',
    'Chácara',
    'Proprietário',
    'Leitura anterior',
    'Leitura atual',
    'Consumo (kWh)',
    'Preço kWh (R$)',
    'Custo energia (R$)',
    'Fundo reserva (R$)',
    'Total (R$)',
    'Situação',
    'Pago em',
  ]
  const body = rows.map((row) => [
    row.year,
    MONTH_NAMES[row.month - 1],
    row.property.name,
    row.owner?.name,
    row.previousReading,
    row.currentReading,
    row.bill.consumption,
    microsToCsv(row.kwhPriceMicros),
    centsToCsv(row.bill.energyCents),
    centsToCsv(row.bill.reserveFundCents),
    centsToCsv(row.bill.totalCents),
    row.paid ? 'Pago' : 'Pendente',
    formatDate(row.paidAt),
  ])
  downloadCsv('historico-rateio-da-agua.csv', toCsv([header, ...body]))
}

function HistoryPage() {
  const { options, history } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [limit, setLimit] = useState(PAGE_SIZE)
  const { rows } = history

  const totals = rows.reduce(
    (acc, row) => {
      acc.consumption += row.bill.consumption
      acc.totalCents += row.bill.totalCents
      if (row.paid) acc.paidCents += row.bill.totalCents
      else acc.pendingCents += row.bill.totalCents
      return acc
    },
    { consumption: 0, totalCents: 0, paidCents: 0, pendingCents: 0 },
  )

  function setFilter(changes: Partial<typeof search>) {
    setLimit(PAGE_SIZE)
    navigate({ search: { ...search, ...changes } })
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Histórico"
        description="Todas as leituras e pagamentos. Use os filtros para encontrar um mês, uma chácara ou o que ainda falta receber."
        actions={
          <Button
            variant="outline"
            disabled={rows.length === 0}
            onClick={() => exportCsv(rows)}
          >
            <Download aria-hidden="true" />
            Baixar planilha
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-4">
        <FilterSelect
          label="Chácara"
          value={search.chacara ?? ''}
          onChange={(value) =>
            setFilter({ chacara: value ? Number(value) : undefined })
          }
          className="min-w-[16rem]"
          options={[
            { value: '', label: 'Todas as chácaras' },
            ...options.properties.map((property) => ({
              value: property.id,
              label: property.name,
            })),
          ]}
        />
        <FilterSelect
          label="Ano"
          value={search.ano ?? ''}
          onChange={(value) =>
            setFilter({ ano: value ? Number(value) : undefined })
          }
          options={[
            { value: '', label: 'Todos os anos' },
            ...history.years.map((year) => ({ value: year, label: year })),
          ]}
        />
        <FilterSelect
          label="Situação"
          value={search.situacao ?? ''}
          onChange={(value) =>
            setFilter({
              situacao: (value || undefined) as 'pago' | 'pendente' | undefined,
            })
          }
          options={[
            { value: '', label: 'Pagas e pendentes' },
            { value: 'pendente', label: 'Só pendentes' },
            { value: 'pago', label: 'Só pagas' },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nenhuma leitura encontrada">
          Mude os filtros acima ou lance as leituras na tela Leituras.
        </EmptyState>
      ) : (
        <>
          <p className="text-lg">
            <strong>{rows.length}</strong>{' '}
            {rows.length === 1 ? 'cobrança' : 'cobranças'}, somando{' '}
            <strong className="tabular-nums">
              {formatBRL(totals.totalCents)}
            </strong>{' '}
            ({formatNumber(totals.consumption)} kWh).{' '}
            <span className="text-paid">
              Pago:{' '}
              <strong className="tabular-nums">
                {formatBRL(totals.paidCents)}
              </strong>
              .
            </span>{' '}
            Pendente:{' '}
            <strong className="tabular-nums">
              {formatBRL(totals.pendingCents)}
            </strong>
            .
          </p>

          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead>Chácara</TableHead>
                  <TableHead>Proprietário</TableHead>
                  <TableHead className="text-right">Consumo (kWh)</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, limit).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="tabular-nums">
                      {formatPeriodShort(row)}
                    </TableCell>
                    <TableCell>
                      <Link
                        to="/chacaras/$id"
                        params={{ id: String(row.property.id) }}
                        className="flex items-center gap-2 font-semibold hover:underline"
                      >
                        <PropertyPlate name={row.property.name} size="sm" />
                        {row.property.name}
                      </Link>
                    </TableCell>
                    <TableCell>{row.owner?.name ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(row.bill.consumption)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatBRL(row.bill.totalCents)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge paid={row.paid} paidAt={row.paidAt} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <PaidToggle readingId={row.id} paid={row.paid} />
                        <Button variant="ghost" size="sm" asChild>
                          <Link
                            to="/relatorios/mensal"
                            search={{
                              ano: row.year,
                              mes: row.month,
                              chacara: row.property.id,
                            }}
                          >
                            <FileText aria-hidden="true" />
                            Cobrança
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {rows.length > limit && (
            <Button
              variant="outline"
              className="self-center"
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
            >
              Mostrar mais ({rows.length - limit} restantes)
            </Button>
          )}
        </>
      )}
    </div>
  )
}
