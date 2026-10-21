import { createFileRoute, Link, useLocation } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { z } from 'zod'
import { EmptyState } from '#/components/page'
import { MonthSheet } from '#/components/readings/month-sheet'
import { Button } from '#/components/ui/button'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { Progress } from '#/components/ui/progress'
import { formatBRL } from '#/lib/money'
import {
  addMonths,
  comparePeriods,
  formatPeriod,
  MONTH_NAMES,
  type Period,
  periodKey,
} from '#/lib/periods'
import { getMonthSheet } from '#/server/readings.functions'

const searchSchema = z.object({
  ano: z.number().int().min(2000).max(2100).optional().catch(undefined),
  mes: z.number().int().min(1).max(12).optional().catch(undefined),
})

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ year: search.ano, month: search.mes }),
  loader: ({ deps }) => getMonthSheet({ data: deps }),
  head: () => ({ meta: [{ title: 'Leituras do mês — Rateio da Água' }] }),
  component: ReadingsPage,
})

const monthSearch = (period: Period) => ({
  ano: period.year,
  mes: period.month,
})

function ReadingsPage() {
  const sheet = Route.useLoaderData()
  const { period, thisMonth, years, summary, rates, rows } = sheet

  return (
    <div className="flex flex-col gap-8">
      <MonthNavigation period={period} thisMonth={thisMonth} years={years} />

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhuma chácara cadastrada"
          action={
            <Button asChild>
              <Link to="/cadastros/chacaras/nova">Cadastrar chácara</Link>
            </Button>
          }
        >
          Cadastre as chácaras e seus proprietários para começar a lançar as
          leituras de cada mês.
        </EmptyState>
      ) : (
        <>
          <MonthSummary summary={summary} />

          <MonthSheet
            key={periodKey(period)}
            period={period}
            rows={rows}
            rates={rates}
          />
        </>
      )}
    </div>
  )
}

function MonthNavigation({
  period,
  thisMonth,
  years,
}: {
  period: Period
  thisMonth: Period
  years: number[]
}) {
  const navigate = Route.useNavigate()
  const previous = addMonths(period, -1)
  const next = addMonths(period, 1)
  const isThisMonth = comparePeriods(period, thisMonth) === 0

  // The month being opened: the pickers show it while it loads, and go back
  // by themselves when leaving is cancelled (readings not saved yet).
  const { ano, mes } = searchSchema.parse(
    useLocation({ select: (location) => location.search }),
  )
  const shown = ano && mes ? { year: ano, month: mes } : thisMonth
  const yearOptions = [...new Set([...years, period.year, shown.year])].sort(
    (a, b) => b - a,
  )
  const open = (changes: Partial<Period>) =>
    navigate({ to: '/', search: monthSearch({ ...shown, ...changes }) })

  return (
    // Phones: the pickers on top, the arrows below them. From md: side by side.
    <nav
      aria-label="Escolher o mês"
      className="grid grid-cols-2 items-center gap-3 md:grid-cols-[auto_1fr_auto]"
    >
      <Button
        variant="outline"
        asChild
        className="col-start-1 row-start-2 justify-self-start md:row-start-1"
      >
        <Link to="/" search={monthSearch(previous)}>
          <ChevronLeft aria-hidden="true" />
          {MONTH_NAMES[previous.month - 1]}
        </Link>
      </Button>
      <div className="col-span-2 col-start-1 row-start-1 flex flex-col items-center gap-2 text-center md:col-span-1 md:col-start-2">
        <h1 className="sr-only">Leituras de {formatPeriod(period)}</h1>
        <p aria-hidden="true" className="text-muted-foreground">
          Leituras de
        </p>
        {/* Any month in two clicks; the arrows go one month at a time. */}
        <div className="flex flex-wrap justify-center gap-2 [&_[data-slot=native-select-icon]]:size-5 [&_[data-slot=native-select-icon]]:opacity-70">
          <PeriodSelect
            label="Mês"
            value={shown.month}
            onChange={(month) => open({ month })}
            options={MONTH_NAMES.map((name, index) => ({
              value: index + 1,
              label: name,
            }))}
          />
          <PeriodSelect
            label="Ano"
            value={shown.year}
            onChange={(year) => open({ year })}
            options={yearOptions.map((year) => ({ value: year, label: year }))}
          />
        </div>
        {!isThisMonth && (
          <Link
            to="/"
            search={monthSearch(thisMonth)}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Ir para {formatPeriod(thisMonth)}
          </Link>
        )}
      </div>
      <Button
        variant="outline"
        asChild
        className="col-start-2 row-start-2 justify-self-end md:col-start-3 md:row-start-1"
      >
        <Link to="/" search={monthSearch(next)}>
          {MONTH_NAMES[next.month - 1]}
          <ChevronRight aria-hidden="true" />
        </Link>
      </Button>
    </nav>
  )
}

/** A big select that reads as the page title: "Outubro ⌄" "2026 ⌄". */
function PeriodSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  options: ReadonlyArray<{ value: number; label: string | number }>
}) {
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-12 pr-10 pl-4 text-[1.5rem] font-bold tracking-[-0.01em] sm:h-14 sm:text-[2rem]"
    >
      {options.map((option) => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}

function MonthSummary({
  summary,
}: {
  summary: Awaited<ReturnType<typeof getMonthSheet>>['summary']
}) {
  return (
    <section
      aria-label="Resumo do mês"
      className="grid gap-6 border-y py-5 md:grid-cols-[1fr_auto] md:items-center"
    >
      <div className="flex flex-col gap-2">
        <p className="text-[1.1rem]">
          <strong>{summary.readCount}</strong> de{' '}
          <strong>{summary.chacaras}</strong>{' '}
          {summary.chacaras === 1
            ? 'chácara com leitura'
            : 'chácaras com leitura'}
          {summary.readCount > 0 && (
            <>
              , <strong>{summary.paidCount}</strong>{' '}
              {summary.paidCount === 1 ? 'paga' : 'pagas'}
            </>
          )}
          .
        </p>
        <Progress
          aria-label="Chácaras com leitura"
          className="h-2.5 max-w-md bg-secondary"
          value={
            summary.chacaras ? (summary.readCount / summary.chacaras) * 100 : 0
          }
        />
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-3 tabular-nums md:gap-x-10">
        <div>
          <dt className="text-sm text-muted-foreground">Total do mês</dt>
          <dd className="text-[1.35rem] font-bold">
            {formatBRL(summary.totalCents)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Já pago</dt>
          <dd className="text-[1.35rem] font-bold text-paid">
            {formatBRL(summary.paidCents)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Falta receber</dt>
          <dd className="text-[1.35rem] font-bold">
            {formatBRL(summary.pendingCents)}
          </dd>
        </div>
      </dl>
    </section>
  )
}
