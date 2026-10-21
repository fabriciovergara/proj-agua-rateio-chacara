import { createFileRoute, Link } from '@tanstack/react-router'
import { Printer } from 'lucide-react'
import { z } from 'zod'
import { FilterSelect } from '#/components/filter-select'
import { EmptyState } from '#/components/page'
import { MonthlyBill } from '#/components/reports/monthly-bill'
import { Button } from '#/components/ui/button'
import { formatBRL } from '#/lib/money'
import { formatPeriod, MONTH_NAMES } from '#/lib/periods'
import { getMonthlyBills, getReportOptions } from '#/server/reports.functions'

export const Route = createFileRoute('/relatorios/mensal')({
  validateSearch: z.object({
    ano: z.number().int().min(2000).max(2100).optional().catch(undefined),
    mes: z.number().int().min(1).max(12).optional().catch(undefined),
    chacara: z.number().int().positive().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const options = await getReportOptions()
    const period =
      deps.ano && deps.mes
        ? { year: deps.ano, month: deps.mes }
        : options.defaultPeriod
    const report = await getMonthlyBills({
      data: { ...period, propertyId: deps.chacara },
    })
    return { options, report }
  },
  head: () => ({ meta: [{ title: 'Cobrança do mês — Rateio da Água' }] }),
  component: MonthlyReportPage,
})

function MonthlyReportPage() {
  const { options, report } = Route.useLoaderData()
  const { chacara } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { period } = report

  const go = (changes: { ano?: number; mes?: number; chacara?: number }) =>
    navigate({
      search: { ano: period.year, mes: period.month, chacara, ...changes },
    })

  const years = [...new Set([...options.years, period.year])].sort(
    (a, b) => b - a,
  )
  const total = report.bills.reduce(
    (sum, bill) => sum + bill.reading.bill.totalCents,
    0,
  )

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end gap-4 print:hidden">
        <FilterSelect
          label="Mês"
          value={period.month}
          onChange={(value) => go({ mes: Number(value) })}
          options={MONTH_NAMES.map((name, index) => ({
            value: index + 1,
            label: name,
          }))}
        />
        <FilterSelect
          label="Ano"
          value={period.year}
          onChange={(value) => go({ ano: Number(value) })}
          options={years.map((year) => ({ value: year, label: year }))}
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
          title={`Nenhuma leitura em ${formatPeriod(period)}`}
          action={
            <Button asChild>
              <Link to="/" search={{ ano: period.year, mes: period.month }}>
                Lançar leituras deste mês
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
              {report.bills.length} cobranças em {formatPeriod(period)}, somando{' '}
              <strong className="text-foreground tabular-nums">
                {formatBRL(total)}
              </strong>
              . Na impressão, cada cobrança sai em uma página.
            </p>
          )}
          {report.bills.map((bill) => (
            <MonthlyBill key={bill.reading.id} report={report} bill={bill} />
          ))}
        </>
      )}
    </div>
  )
}
