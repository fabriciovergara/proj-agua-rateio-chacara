import { createFileRoute, Link } from '@tanstack/react-router'
import { FileText, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { Notice } from '#/components/page'
import { PropertyPlate } from '#/components/property-plate'
import {
  type Before,
  NewReadingForm,
  type OpenPeriod,
  ReadingEditorRow,
  type ReadingValues,
  toDraft,
} from '#/components/readings/reading-editor-row'
import { StatusBadge } from '#/components/status-badge'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Label } from '#/components/ui/label'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
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
import { type DateRange, formatDateRange, yearOf } from '#/lib/periods'
import { parseId } from '#/lib/route-params'
import { useAction } from '#/lib/use-action'
import {
  createReading,
  deleteReading,
  getPropertySheet,
  updateReading,
} from '#/server/readings.functions'

export const Route = createFileRoute('/chacaras/$id')({
  validateSearch: z.object({
    ano: z.number().int().optional().catch(undefined),
  }),
  loader: ({ params }) =>
    getPropertySheet({ data: { propertyId: parseId(params.id) } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.property.name} — Rateio da Água`
          : 'Chácara — Rateio da Água',
      },
    ],
  }),
  component: PropertySheetPage,
})

type Sheet = Awaited<ReturnType<typeof getPropertySheet>>
type Row = Sheet['readings'][number]

function relinkMessage(relinked: DateRange[] | undefined) {
  return (relinked ?? [])
    .map(
      (other) =>
        ` A leitura de ${formatDateRange(other)} também foi corrigida.`,
    )
    .join('')
}

const beforeOf = (reading: Row | undefined): Before | null =>
  reading
    ? {
        startDate: reading.startDate,
        endDate: reading.endDate,
        previousReading: reading.previousReading,
        currentReading: reading.currentReading,
      }
    : null

function PropertySheetPage() {
  const sheet = Route.useLoaderData()
  const { ano } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { property, owner, readings } = sheet

  const years = [
    ...new Set(readings.map((r) => yearOf(r.period.endDate))),
  ].sort((a, b) => b - a)
  const visible = ano
    ? readings.filter((r) => yearOf(r.period.endDate) === ano)
    : readings

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <PropertyPlate name={property.name} size="lg" />
          <div>
            <h1 className="text-[2rem] leading-tight font-bold">
              {property.name}
            </h1>
            {!property.active && (
              <p className="mt-1 font-semibold text-pending">
                Chácara inativa: não aparece na tela de leituras.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <Link
              to="/cadastros/chacaras/$id"
              params={{ id: String(property.id) }}
            >
              <Pencil aria-hidden="true" />
              Editar cadastro
            </Link>
          </Button>
          {owner && (
            <Button variant="outline" asChild>
              <Link
                to="/relatorios/anual"
                search={{ proprietario: owner.id, ano: ano ?? years[0] }}
              >
                <FileText aria-hidden="true" />
                Relatório anual
              </Link>
            </Button>
          )}
        </div>
      </header>

      <dl className="grid gap-6 border-y py-5 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">Proprietário</dt>
          <dd className="text-[1.25rem] font-bold">
            {owner ? (
              <Link
                to="/cadastros/proprietarios/$id"
                params={{ id: String(owner.id) }}
                className="hover:underline"
              >
                {owner.name}
              </Link>
            ) : (
              'Sem proprietário'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Chácara</dt>
          <dd className="text-[1.25rem] font-bold">{property.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Hidrômetro</dt>
          <dd className="text-[1.25rem] font-bold tabular-nums">
            {property.meterNumber ?? 'Não informado'}
          </dd>
        </div>
      </dl>

      <section
        aria-labelledby="titulo-leituras"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="titulo-leituras" className="text-[1.35rem] font-bold">
              Leituras
            </h2>
            <p className="text-muted-foreground">
              A última leitura de cada linha é a leitura atual da linha de cima:
              corrigir uma corrige a outra. Clique no lápis para corrigir uma
              linha.
            </p>
          </div>
          {years.length > 1 && (
            <div className="flex items-center gap-3">
              <Label htmlFor="filtro-ano" className="text-base">
                Mostrar
              </Label>
              <NativeSelect
                id="filtro-ano"
                className="bg-background"
                value={ano ?? ''}
                onChange={(event) =>
                  navigate({
                    search: {
                      ano: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    },
                    replace: true,
                  })
                }
              >
                <NativeSelectOption value="">Todos os anos</NativeSelectOption>
                {years.map((year) => (
                  <NativeSelectOption key={year} value={year}>
                    {year}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>

        <ReadingsTable sheet={sheet} rows={visible} />
      </section>
    </div>
  )
}

function ReadingsTable({ sheet, rows }: { sheet: Sheet; rows: Row[] }) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const create = useAction(createReading, {
    success: (result) =>
      `Leitura adicionada.${relinkMessage(result?.relinked)}`,
  })
  const update = useAction(updateReading, {
    success: (result) => `Leitura corrigida.${relinkMessage(result?.relinked)}`,
  })
  const remove = useAction(deleteReading, {
    success: 'Leitura apagada. A conta do período foi dividida de novo.',
  })
  const propertyId = sheet.property.id
  const all = sheet.readings

  /** Periods without a reading of this chácara, newest first. */
  const taken = new Set(all.map((reading) => reading.periodId))
  const open: OpenPeriod[] = sheet.periods
    .filter((period) => !taken.has(period.id))
    .map((period) => ({
      ...period,
      before: beforeOf(
        all.filter((r) => r.period.startDate < period.startDate).at(-1),
      ),
    }))
  // The period after the last reading, else the newest one still open.
  const last = all.at(-1)
  const nextOpen =
    open
      .filter((period) => !last || period.startDate > last.period.startDate)
      .at(-1) ?? open[0]

  const totals = rows.reduce(
    (acc, r) => ({
      consumption: acc.consumption + r.bill.consumption,
      energyCents: acc.energyCents + (r.bill.energyCents ?? 0),
      reserveFundCents: acc.reserveFundCents + r.bill.reserveFundCents,
      totalCents: acc.totalCents + (r.bill.totalCents ?? 0),
    }),
    { consumption: 0, energyCents: 0, reserveFundCents: 0, totalCents: 0 },
  )

  async function handleCreate(periodId: number, values: ReadingValues) {
    const result = await create.run({
      data: { propertyId, periodId, ...values },
    })
    return Boolean(result)
  }

  async function handleUpdate(id: number, values: ReadingValues) {
    const result = await update.run({ data: { id, ...values } })
    if (result) setEditingId(null)
    return Boolean(result)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="gap-0 overflow-hidden py-0">
        <Table className="text-[0.95rem]">
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Período</TableHead>
              <TableHead className="text-right whitespace-normal">
                Última leitura
              </TableHead>
              <TableHead className="text-right whitespace-normal">
                Leitura atual
              </TableHead>
              <TableHead className="text-right whitespace-normal">
                Consumo (m³)
              </TableHead>
              <TableHead className="text-right whitespace-normal">
                Energia
              </TableHead>
              <TableHead className="text-right whitespace-normal">
                Fundo reserva
              </TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-6 text-muted-foreground">
                  Nenhuma leitura ainda. Use o formulário abaixo para lançar a
                  primeira.
                </TableCell>
              </TableRow>
            )}
            {rows.map((reading) => {
              const index = all.findIndex((r) => r.id === reading.id)
              const before = all[index - 1]
              const label = formatDateRange(reading)
              return editingId === reading.id ? (
                <ReadingEditorRow
                  key={reading.id}
                  label={label}
                  initial={toDraft(reading)}
                  before={beforeOf(before)}
                  linked={
                    !before || before.currentReading === reading.previousReading
                  }
                  canPay={reading.period.energyBillCents !== null}
                  pending={update.pending}
                  onSubmit={(values) => handleUpdate(reading.id, values)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <TableRow key={reading.id}>
                  <TableCell className="tabular-nums">{label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(reading.previousReading)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatNumber(reading.currentReading)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(reading.bill.consumption)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {reading.bill.energyCents === null
                      ? '—'
                      : formatBRL(reading.bill.energyCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBRL(reading.bill.reserveFundCents)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {reading.bill.totalCents === null ? (
                      <span className="font-normal text-muted-foreground">
                        Aguardando conta
                      </span>
                    ) : (
                      formatBRL(reading.bill.totalCents)
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge paid={reading.paid} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Corrigir leitura de ${label}`}
                        disabled={editingId !== null}
                        onClick={() => setEditingId(reading.id)}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <ConfirmDialog
                        title={`Apagar a leitura de ${label}?`}
                        description={
                          <p>
                            A cobrança deste período também deixa de existir, e
                            a conta de energia é dividida de novo entre as
                            outras chácaras. Esta ação não pode ser desfeita.
                          </p>
                        }
                        confirmLabel="Apagar leitura"
                        onConfirm={() =>
                          remove.run({ data: { id: reading.id } })
                        }
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Apagar leitura de ${label}`}
                            disabled={editingId !== null || remove.pending}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          {rows.length > 1 && (
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell colSpan={3}>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(totals.consumption)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(totals.energyCents)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(totals.reserveFundCents)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(totals.totalCents)}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </Card>
      {nextOpen ? (
        <NewReadingForm
          key={`${nextOpen.id}-${all.length}-${last?.currentReading}`}
          periods={open}
          initialPeriodId={nextOpen.id}
          pending={create.pending}
          onSubmit={handleCreate}
        />
      ) : (
        <Notice
          action={
            <Button asChild variant="outline">
              <Link to="/">Ir para Leituras</Link>
            </Button>
          }
        >
          {sheet.periods.length === 0
            ? 'Ainda não há períodos de leitura. Crie o primeiro na tela Leituras.'
            : 'Esta chácara já tem leitura em todos os períodos. Para lançar outra, crie um novo período na tela Leituras.'}
        </Notice>
      )}
    </div>
  )
}
