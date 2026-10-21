import { createFileRoute, Link } from '@tanstack/react-router'
import { Printer } from 'lucide-react'
import { z } from 'zod'
import { FilterSelect } from '#/components/filter-select'
import { EmptyState } from '#/components/page'
import { PropertyPlate } from '#/components/property-plate'
import { formatAddress } from '#/components/reports/monthly-bill'
import { StatusBadge } from '#/components/status-badge'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { formatBRL, formatNumber } from '#/lib/money'
import { getAnnualReport, getReportOptions } from '#/server/reports.functions'
import type { AnnualReport } from '#/server/reports.server'

export const Route = createFileRoute('/relatorios/anual')({
  validateSearch: z.object({
    proprietario: z.number().int().positive().optional().catch(undefined),
    ano: z.number().int().min(2000).max(2100).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const options = await getReportOptions()
    const year = deps.ano ?? options.defaultPeriod.year
    const report = deps.proprietario
      ? await getAnnualReport({ data: { ownerId: deps.proprietario, year } })
      : null
    return { options, report, year }
  },
  head: () => ({ meta: [{ title: 'Relatório anual — Rateio da Água' }] }),
  component: AnnualReportPage,
})

function AnnualReportPage() {
  const { options, report, year } = Route.useLoaderData()
  const { proprietario } = Route.useSearch()
  const navigate = Route.useNavigate()

  const years = [...new Set([...options.years, year])].sort((a, b) => b - a)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end gap-4 print:hidden">
        <FilterSelect
          label="Proprietário"
          value={proprietario ?? ''}
          onChange={(value) =>
            navigate({
              search: {
                proprietario: value ? Number(value) : undefined,
                ano: year,
              },
            })
          }
          className="min-w-[18rem]"
          options={[
            { value: '', label: 'Escolha o proprietário' },
            ...options.owners.map((owner) => ({
              value: owner.id,
              label: owner.name,
            })),
          ]}
        />
        <FilterSelect
          label="Ano"
          value={year}
          onChange={(value) =>
            navigate({ search: { proprietario, ano: Number(value) } })
          }
          options={years.map((option) => ({ value: option, label: option }))}
        />
        <Button
          className="ml-auto"
          size="lg"
          disabled={!report}
          onClick={() => window.print()}
        >
          <Printer aria-hidden="true" />
          Imprimir
        </Button>
      </div>

      {!proprietario ? (
        <EmptyState title="Escolha o proprietário">
          O relatório mostra, mês a mês, o consumo de cada chácara do
          proprietário, o valor e se já foi pago.
        </EmptyState>
      ) : !report ? (
        <EmptyState title="Proprietário não encontrado">
          O cadastro pode ter sido apagado. Escolha outro na lista.
        </EmptyState>
      ) : (
        <AnnualDocument report={report} />
      )}
    </div>
  )
}

function AnnualDocument({ report }: { report: AnnualReport }) {
  const { owner, chacaras, totals } = report

  return (
    <Card className="mx-auto w-full max-w-[60rem] gap-8 px-6 py-6 shadow-md sm:px-10 sm:py-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="border-b-2 border-foreground pb-5">
        {report.groupName && (
          <p className="font-semibold text-muted-foreground">
            {report.groupName}
          </p>
        )}
        <h2 className="text-[1.6rem] leading-tight font-bold">
          Relatório anual de {report.year}
        </h2>
        <p className="text-lg font-bold">{owner.name}</p>
        <p className="text-muted-foreground">
          {[
            owner.document && `Documento ${owner.document}`,
            owner.phone,
            owner.email,
          ]
            .filter(Boolean)
            .join(' — ')}
        </p>
      </header>

      {chacaras.length === 0 ? (
        <p className="text-muted-foreground">
          Nenhuma chácara está ligada a este proprietário.{' '}
          <Link
            to="/cadastros/chacaras"
            className="text-primary underline print:hidden"
          >
            Ligar em Cadastros
          </Link>
        </p>
      ) : (
        chacaras.map(({ property, months, totals: subtotal }) => (
          <section key={property.id} className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <PropertyPlate name={property.name} />
              <div>
                <h3 className="text-xl font-bold">{property.name}</h3>
                <p className="text-muted-foreground">
                  {[
                    ...formatAddress(property),
                    property.meterNumber &&
                      `Hidrômetro ${property.meterNumber}`,
                  ]
                    .filter(Boolean)
                    .join(' — ')}
                </p>
              </div>
            </div>
            <Table className="text-[0.95rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Leitura anterior</TableHead>
                  <TableHead className="text-right">Leitura atual</TableHead>
                  <TableHead className="text-right">Consumo (kWh)</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map(({ month, name, reading }) => (
                  <TableRow key={month}>
                    <TableCell>{name}</TableCell>
                    {reading ? (
                      <>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(reading.previousReading)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(reading.currentReading)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(reading.bill.consumption)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatBRL(reading.bill.totalCents)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge paid={reading.paid} />
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={5} className="text-muted-foreground">
                        Sem leitura
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="font-bold">
                  <TableCell colSpan={3}>Total de {report.year}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(subtotal.consumption)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBRL(subtotal.totalCents)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </section>
        ))
      )}

      {chacaras.length > 0 && (
        <dl className="grid gap-4 border-t-2 border-foreground pt-5 tabular-nums sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">Total do ano</dt>
            <dd className="text-[1.4rem] font-bold">
              {formatBRL(totals.totalCents)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Pago</dt>
            <dd className="text-[1.4rem] font-bold text-paid">
              {formatBRL(totals.paidCents)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Pendente</dt>
            <dd className="text-[1.4rem] font-bold">
              {formatBRL(totals.pendingCents)}
            </dd>
          </div>
        </dl>
      )}
    </Card>
  )
}
