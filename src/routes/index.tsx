import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { z } from 'zod'
import { EmptyState } from '#/components/page'
import { MonthSheet } from '#/components/readings/month-sheet'
import { Button } from '#/components/ui/button'
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
  const { period, thisMonth, summary, rates, rows } = sheet

  return (
    <div className="flex flex-col gap-8">
      <MonthNavigation period={period} thisMonth={thisMonth} />

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
}: {
  period: Period
  thisMonth: Period
}) {
  const previous = addMonths(period, -1)
  const next = addMonths(period, 1)
  const isThisMonth = comparePeriods(period, thisMonth) === 0

  return (
    <nav
      aria-label="Escolher o mês"
      className="grid grid-cols-[auto_1fr_auto] items-center gap-3"
    >
      <Button variant="outline" asChild>
        <Link to="/" search={monthSearch(previous)}>
          <ChevronLeft aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">
            {MONTH_NAMES[previous.month - 1]}
          </span>
        </Link>
      </Button>
      <div className="text-center">
        <p className="text-muted-foreground">Leituras de</p>
        <h1 className="text-[2rem] leading-tight font-bold tracking-[-0.01em] sm:text-[2.4rem]">
          {formatPeriod(period)}
        </h1>
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
      <Button variant="outline" asChild>
        <Link to="/" search={monthSearch(next)}>
          <span className="sr-only sm:not-sr-only">
            {MONTH_NAMES[next.month - 1]}
          </span>
          <ChevronRight aria-hidden="true" />
        </Link>
      </Button>
    </nav>
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
