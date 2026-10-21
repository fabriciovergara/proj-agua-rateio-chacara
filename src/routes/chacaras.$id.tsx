import { createFileRoute, Link } from '@tanstack/react-router'
import { FileText, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { PropertyPlate } from '#/components/property-plate'
import {
  NewReadingForm,
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
import { formatBRL, formatKwhPrice, formatNumber } from '#/lib/money'
import { comparePeriods, formatPeriod, MONTH_NAMES } from '#/lib/periods'
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

function relinkMessage(relinked: { year: number; month: number } | null) {
  return relinked
    ? ` A leitura anterior de ${formatPeriod(relinked)} também foi atualizada.`
    : ''
}

function PropertySheetPage() {
  const sheet = Route.useLoaderData()
  const { ano } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { property, owner, readings } = sheet

  const years = [...new Set(readings.map((r) => r.year))].sort((a, b) => b - a)
  const visible = ano ? readings.filter((r) => r.year === ano) : readings

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
              A leitura anterior vem da linha de cima. Clique no lápis para
              corrigir uma linha.
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

function ReadingsTable({
  sheet,
  rows,
}: {
  sheet: Sheet
  rows: Sheet['readings']
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const create = useAction(createReading, {
    success: (result) =>
      `Leitura adicionada.${relinkMessage(result?.relinked ?? null)}`,
  })
  const update = useAction(updateReading, {
    success: (result) =>
      `Leitura corrigida.${relinkMessage(result?.relinked ?? null)}`,
  })
  const remove = useAction(deleteReading, { success: 'Leitura apagada.' })
  const propertyId = sheet.property.id

  /** The reading right before `period` (readings come sorted by month). */
  const expectedPrevious =
    (excludeId?: number) => (period: { year: number; month: number }) => {
      const before = sheet.readings
        .filter((r) => r.id !== excludeId && comparePeriods(r, period) < 0)
        .at(-1)
      return before
        ? { value: before.currentReading, label: formatPeriod(before) }
        : null
    }

  const totals = rows.reduce(
    (acc, r) => ({
      consumption: acc.consumption + r.bill.consumption,
      energyCents: acc.energyCents + r.bill.energyCents,
      reserveFundCents: acc.reserveFundCents + r.bill.reserveFundCents,
      totalCents: acc.totalCents + r.bill.totalCents,
    }),
    { consumption: 0, energyCents: 0, reserveFundCents: 0, totalCents: 0 },
  )

  async function handleCreate(values: ReadingValues) {
    const result = await create.run({ data: { propertyId, ...values } })
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
              <TableHead>Ano</TableHead>
              <TableHead>Mês</TableHead>
              <TableHead className="text-right whitespace-normal">
                Leitura atual
              </TableHead>
              <TableHead className="text-right whitespace-normal">
                Leitura anterior
              </TableHead>
              <TableHead className="text-right whitespace-normal">
                Consumo (kWh)
              </TableHead>
              <TableHead className="text-right whitespace-normal">
                Preço kWh
              </TableHead>
              <TableHead className="text-right whitespace-normal">
                Custo energia
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
                <TableCell colSpan={11} className="py-6 text-muted-foreground">
                  Nenhuma leitura ainda. Use o formulário abaixo para lançar a
                  primeira.
                </TableCell>
              </TableRow>
            )}
            {rows.map((reading) =>
              editingId === reading.id ? (
                <ReadingEditorRow
                  key={reading.id}
                  label={formatPeriod(reading)}
                  initial={toDraft(reading)}
                  expectedPrevious={expectedPrevious(reading.id)}
                  pending={update.pending}
                  onSubmit={(values) => handleUpdate(reading.id, values)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <TableRow key={reading.id}>
                  <TableCell className="tabular-nums">{reading.year}</TableCell>
                  <TableCell>{MONTH_NAMES[reading.month - 1]}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatNumber(reading.currentReading)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(reading.previousReading)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(reading.bill.consumption)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatKwhPrice(reading.kwhPriceMicros)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBRL(reading.bill.energyCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBRL(reading.bill.reserveFundCents)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">
                    {formatBRL(reading.bill.totalCents)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge paid={reading.paid} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Corrigir leitura de ${formatPeriod(reading)}`}
                        disabled={editingId !== null}
                        onClick={() => setEditingId(reading.id)}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <ConfirmDialog
                        title={`Apagar a leitura de ${formatPeriod(reading)}?`}
                        description={
                          <p>
                            A cobrança deste mês também deixa de existir. Esta
                            ação não pode ser desfeita.
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
                            aria-label={`Apagar leitura de ${formatPeriod(reading)}`}
                            disabled={editingId !== null || remove.pending}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
          {rows.length > 1 && (
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell colSpan={4}>Total do período</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(totals.consumption)}
                </TableCell>
                <TableCell />
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
      <NewReadingForm
        key={`${sheet.newRow.year}-${sheet.newRow.month}-${sheet.newRow.previousReading}`}
        initial={toDraft({
          ...sheet.newRow,
          currentReading: null,
          paid: false,
        })}
        expectedPrevious={expectedPrevious()}
        pending={create.pending}
        onSubmit={handleCreate}
      />
    </div>
  )
}
