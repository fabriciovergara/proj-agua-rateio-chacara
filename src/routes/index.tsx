import { createFileRoute, Link, useLocation } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { z } from 'zod'
import { EmptyState } from '#/components/page'
import {
  FirstPeriodForm,
  NewPeriodDialog,
} from '#/components/readings/new-period'
import { PeriodSheet } from '#/components/readings/period-sheet'
import { Button } from '#/components/ui/button'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { type DateRange, formatDateRange } from '#/lib/periods'
import { getPeriodSheet } from '#/server/readings.functions'

const searchSchema = z.object({
  periodo: z.number().int().positive().optional().catch(undefined),
})

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ periodId: search.periodo }),
  loader: ({ deps }) => getPeriodSheet({ data: deps }),
  head: () => ({ meta: [{ title: 'Leituras — Rateio da Água' }] }),
  component: ReadingsPage,
})

type Sheet = Awaited<ReturnType<typeof getPeriodSheet>>

function ReadingsPage() {
  const sheet = Route.useLoaderData()
  const { period, periods, rows, newPeriod } = sheet

  const noChacaras = (
    <EmptyState
      title="Nenhuma chácara cadastrada"
      action={
        <Button asChild>
          <Link to="/cadastros/chacaras/nova">Cadastrar chácara</Link>
        </Button>
      }
    >
      Cadastre as chácaras e seus proprietários para começar a lançar as
      leituras dos hidrômetros.
    </EmptyState>
  )

  if (!period) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-[2rem] font-bold tracking-[-0.01em]">Leituras</h1>
        {sheet.chacaras === 0 ? (
          noChacaras
        ) : (
          <FirstPeriodForm defaults={newPeriod} />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <PeriodNavigation
        period={period}
        periods={periods}
        newPeriod={newPeriod}
      />
      {rows.length === 0 ? (
        noChacaras
      ) : (
        <PeriodSheet key={period.id} period={period} rows={rows} />
      )}
    </div>
  )
}

function PeriodNavigation({
  period,
  periods,
  newPeriod,
}: {
  period: NonNullable<Sheet['period']>
  periods: Sheet['periods']
  newPeriod: DateRange
}) {
  const navigate = Route.useNavigate()
  // The period being opened: the picker shows it while it loads, and goes
  // back by itself when leaving is cancelled (readings not saved yet).
  const { periodo } = searchSchema.parse(
    useLocation({ select: (location) => location.search }),
  )
  const shown = periodo ?? period.id
  const newest = periods[0]

  return (
    // Phones: the picker on top, the buttons below it. From md: side by side.
    <nav
      aria-label="Escolher o período"
      className="grid grid-cols-2 items-center gap-3 md:grid-cols-[auto_1fr_auto]"
    >
      {period.previousId ? (
        <Button
          variant="outline"
          asChild
          className="col-start-1 row-start-2 justify-self-start md:row-start-1"
        >
          <Link to="/" search={{ periodo: period.previousId }}>
            <ChevronLeft aria-hidden="true" />
            Período anterior
          </Link>
        </Button>
      ) : (
        <span className="col-start-1 row-start-2 md:row-start-1" />
      )}
      <div className="col-span-2 col-start-1 row-start-1 flex flex-col items-center gap-2 text-center md:col-span-1 md:col-start-2">
        <h1 className="sr-only">Leituras de {formatDateRange(period)}</h1>
        <p aria-hidden="true" className="text-muted-foreground">
          Leituras de
        </p>
        <NativeSelect
          aria-label="Período"
          value={shown}
          onChange={(event) =>
            navigate({
              to: '/',
              search: { periodo: Number(event.target.value) },
            })
          }
          className="h-12 pr-10 pl-4 text-[1.2rem] font-bold tracking-[-0.01em] tabular-nums sm:h-14 sm:text-[1.65rem] [&_[data-slot=native-select-icon]]:size-5 [&_[data-slot=native-select-icon]]:opacity-70"
        >
          {periods.map((option) => (
            <NativeSelectOption key={option.id} value={option.id}>
              {formatDateRange(option)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {newest && newest.id !== period.id && (
          <Link
            to="/"
            search={{ periodo: newest.id }}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Ir para o período mais recente
          </Link>
        )}
      </div>
      {period.nextId ? (
        <Button
          variant="outline"
          asChild
          className="col-start-2 row-start-2 justify-self-end md:col-start-3 md:row-start-1"
        >
          <Link to="/" search={{ periodo: period.nextId }}>
            Próximo período
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <NewPeriodDialog
          defaults={newPeriod}
          className="col-start-2 row-start-2 justify-self-end md:col-start-3 md:row-start-1"
        />
      )}
    </nav>
  )
}
