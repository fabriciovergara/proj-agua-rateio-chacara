import { createFileRoute, Link } from '@tanstack/react-router'
import { Printer } from 'lucide-react'
import { z } from 'zod'
import { FilterSelect } from '#/components/filter-select'
import { EmptyState } from '#/components/page'
import { PeriodBill } from '#/components/reports/period-bill'
import { Button } from '#/components/ui/button'
import { formatBRL } from '#/lib/money'
import { formatDateRange } from '#/lib/periods'
import { getPeriodBills, getReportOptions } from '#/server/reports.functions'

export const Route = createFileRoute('/relatorios/periodo')({
  validateSearch: z.object({
    periodo: z.number().int().positive().optional().catch(undefined),
    chacara: z.number().int().positive().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const options = await getReportOptions()
    const periodId = deps.periodo ?? options.defaultPeriodId
    const report = periodId
      ? await getPeriodBills({
          data: { periodId, propertyId: deps.chacara },
        })
      : null
    return { options, report }
  },
  head: () => ({ meta: [{ title: 'Cobranças do período — Rateio da Água' }] }),
  component: PeriodReportPage,
})

function PeriodReportPage() {
  const { options, report } = Route.useLoaderData()
  const { chacara } = Route.useSearch()
  const navigate = Route.useNavigate()

  if (!report) {
    return (
      <EmptyState
        title="Nenhum período de leitura"
        action={
          <Button asChild>
            <Link to="/">Lançar leituras</Link>
          </Button>
        }
      >
        As cobranças são geradas a partir das leituras de cada período.
      </EmptyState>
    )
  }

  const { period } = report
  const go = (changes: { periodo?: number; chacara?: number }) =>
    navigate({ search: { periodo: period.id, chacara, ...changes } })
  const total = report.bills.reduce(
    (sum, bill) => sum + (bill.reading.bill.totalCents ?? 0),
    0,
  )

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end gap-4 print:hidden">
        <FilterSelect
          label="Período"
          value={period.id}
          onChange={(value) => go({ periodo: Number(value) })}
          className="min-w-[16rem] tabular-nums"
          options={options.periods.map((option) => ({
            value: option.id,
            label: formatDateRange(option),
          }))}
        />
        <FilterSelect
          label="Chácara"
          value={chacara ?? ''}
          onChange={(value) =>
            go({ chacara: value ? Number(value) : undefined })
          }
          className="min-w-[16rem]"
          options={[
            { value: '', label: 'Todas as chácaras' },
            ...options.properties.map((property) => ({
              value: property.id,
              label: property.ownerName
                ? `${property.name} (${property.ownerName})`
                : property.name,
            })),
          ]}
        />
        <Button
          className="ml-auto"
          size="lg"
          disabled={report.bills.length === 0}
          onClick={() => window.print()}
        >
          <Printer aria-hidden="true" />
          {report.bills.length > 1
            ? `Imprimir as ${report.bills.length} cobranças`
            : 'Imprimir'}
        </Button>
      </div>

      {report.bills.length === 0 ? (
        <EmptyState
          title={`Nenhuma leitura de ${formatDateRange(period)}`}
          action={
            <Button asChild>
              <Link to="/" search={{ periodo: period.id }}>
                Lançar leituras deste período
              </Link>
            </Button>
          }
        >
          A cobrança é gerada a partir da leitura do hidrômetro.
        </EmptyState>
      ) : (
        <>
          {report.bills.length > 1 && (
            <p className="text-muted-foreground print:hidden">
              {report.bills.length} cobranças de {formatDateRange(period)}
              {period.energyBillCents === null ? (
                ', ainda sem o valor da conta de energia'
              ) : (
                <>
                  , somando{' '}
                  <strong className="text-foreground tabular-nums">
                    {formatBRL(total)}
                  </strong>
                </>
              )}
              . Na impressão, cada cobrança sai em uma página.
            </p>
          )}
          {report.bills.map((bill) => (
            <PeriodBill key={bill.reading.id} report={report} bill={bill} />
          ))}
        </>
      )}
    </div>
  )
}
