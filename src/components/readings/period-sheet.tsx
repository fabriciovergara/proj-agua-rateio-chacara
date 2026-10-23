import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import { cn } from 'cn'
import { CalendarDays, Check, FileText, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { DateInput, FormField, MeterInput, MoneyInput } from '#/components/form'
import { PropertyPlate } from '#/components/property-plate'
import { PaidToggle } from '#/components/readings/paid-toggle'
import { StatusBadge } from '#/components/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { FieldGroup } from '#/components/ui/field'
import { Label } from '#/components/ui/label'
import { Progress } from '#/components/ui/progress'
import {
  isUnusualConsumption,
  pricePerCubicMeter,
  splitEnergyBill,
} from '#/lib/billing'
import {
  centsToInput,
  formatBRL,
  formatNumber,
  formatUnitPrice,
  parseCents,
} from '#/lib/money'
import {
  type DateRange,
  formatDate,
  formatDateRange,
  parseDate,
} from '#/lib/periods'
import { useAction } from '#/lib/use-action'
import { deletePeriod, savePeriodSheet } from '#/server/readings.functions'
import type { PeriodSheet as SheetData } from '#/server/readings.server'

type Period = NonNullable<SheetData['period']>
type Row = SheetData['rows'][number]

/** Chácara, Última leitura, Leitura atual, Valor, Pagamento. */
const COLUMNS =
  'lg:grid-cols-[minmax(14rem,1.35fr)_minmax(8.5rem,0.75fr)_minmax(9.5rem,0.85fr)_minmax(12rem,1fr)_minmax(13rem,1.05fr)]'

interface Draft {
  previous?: string
  current?: string
  start?: string
  end?: string
  meterReplaced?: boolean
  /** "Alterar datas" is open. */
  editingDates?: boolean
}

interface PeriodDraft {
  start: string
  end: string
  bill: string
  fund: string
}

const digits = (text: string) => (text === '' ? null : Number(text))

/**
 * One row as typed: the values, the dates, what is wrong and what saving it
 * also changes. `period` holds the period's dates as typed (null while
 * incomplete).
 */
function evaluate(
  row: Row,
  draft: Draft | undefined,
  period: { startDate: string | null; endDate: string | null },
  saved: Period,
) {
  const { reading, previous: before } = row

  // "Última leitura": the reading's own, or the previous reading's.
  const savedPrevious = reading?.previousReading ?? before?.currentReading
  const savedPreviousText =
    savedPrevious === undefined ? '' : String(savedPrevious)
  const savedCurrentText = reading ? String(reading.currentReading) : ''
  const previousText = draft?.previous ?? savedPreviousText
  const currentText = draft?.current ?? savedCurrentText
  const previous = digits(previousText)
  const current = digits(currentText)

  // Dates follow the period unless the chácara has its own.
  const followsStart = before
    ? before.endsAtPeriodStart
    : !reading || reading.startDate === saved.startDate
  const followsEnd = !reading || reading.endDate === saved.endDate
  const autoStart = followsStart
    ? period.startDate
    : (before?.endDate ?? reading?.startDate ?? null)
  const autoEnd = followsEnd ? period.endDate : (reading?.endDate ?? null)
  const startText = draft?.start ?? formatDate(autoStart)
  const endText = draft?.end ?? formatDate(autoEnd)
  const startDate = parseDate(startText)
  const endDate = parseDate(endText)
  const ownDates = startDate !== period.startDate || endDate !== period.endDate

  const valuesChanged =
    previousText !== savedPreviousText || currentText !== savedCurrentText
  const datesChanged =
    (draft?.start !== undefined && startDate !== autoStart) ||
    (draft?.end !== undefined && endDate !== autoEnd)
  const dirty =
    (valuesChanged || datesChanged) && (reading !== null || currentText !== '')

  /** The previous reading follows "Última leitura" (same meter). */
  const linked = reading
    ? before?.currentReading === reading.previousReading
    : true
  const correctsPrevious =
    before !== null &&
    linked &&
    previous !== null &&
    previous !== before.currentReading
  /** Lower than what came before: only a new meter explains it. */
  const meterQuestion =
    correctsPrevious && previous < (before?.previousReading ?? 0)
  const meterReplaced = meterQuestion && draft?.meterReplaced === true

  let error: string | null = null
  if (dirty) {
    if (current === null) error = 'Informe a leitura atual.'
    else if (previous === null) error = 'Informe a última leitura.'
    else if (current < previous)
      error = `Menor que a última leitura (${formatNumber(previous)}).`
    else if (meterQuestion && !meterReplaced)
      error = `A última leitura é menor que a anterior a ela (${formatNumber(before?.previousReading ?? 0)}). Confira o número ou marque que o hidrômetro foi trocado.`
    else if (!startDate || !endDate) error = 'Confira as datas (dd/mm/aaaa).'
    else if (startDate >= endDate)
      error = 'A data da leitura precisa ser depois da última leitura.'
  }

  const valid = !error && current !== null && previous !== null
  const consumption = dirty
    ? valid
      ? (current ?? 0) - (previous ?? 0)
      : null
    : (reading?.bill.consumption ?? null)

  return {
    row,
    previousText,
    currentText,
    startText,
    endText,
    range: startDate && endDate ? ({ startDate, endDate } as DateRange) : null,
    ownDates,
    editingDates: draft?.editingDates ?? false,
    dirty,
    error,
    previous,
    current,
    consumption,
    correctsPrevious: correctsPrevious && !meterReplaced && !meterQuestion,
    meterQuestion,
    meterReplaced,
    unusual:
      consumption !== null &&
      dirty &&
      isUnusualConsumption(consumption, row.averageConsumption),
  }
}

type Evaluated = ReturnType<typeof evaluate>

/** What each row charges with the bill as typed: split, plus the fund. */
function priceRows(
  evaluated: Evaluated[],
  billCents: number | null,
  fundCents: number | null,
) {
  const split = evaluated.filter((item) => item.consumption !== null)
  const shares =
    billCents === null
      ? null
      : splitEnergyBill(
          billCents,
          split.map((item) => ({
            key: item.row.property.id,
            consumption: item.consumption ?? 0,
          })),
        )
  return evaluated.map((item) => {
    const { reading } = item.row
    // Paid bills keep what was charged.
    if (reading?.paid) {
      return {
        ...item,
        energyCents: reading.bill.energyCents,
        fundCents: reading.bill.reserveFundCents,
        totalCents: reading.bill.totalCents,
      }
    }
    const energyCents =
      item.consumption === null
        ? null
        : (shares?.get(item.row.property.id) ?? null)
    return {
      ...item,
      energyCents,
      fundCents,
      totalCents:
        energyCents === null || fundCents === null
          ? null
          : energyCents + fundCents,
    }
  })
}

type Priced = ReturnType<typeof priceRows>[number]

/** Moves the cursor to the next reading, like pressing Enter in a spreadsheet. */
function focusNextMeter(from: HTMLElement) {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[data-meter]'),
  )
  const next = inputs[inputs.indexOf(from as HTMLInputElement) + 1]
  if (next) next.focus()
  else document.getElementById('salvar-leituras')?.focus()
}

function savedMessage(result: {
  saved: number
  relinked: Array<{ property: string } & DateRange>
}) {
  const parts = [
    result.saved === 1
      ? '1 leitura salva.'
      : result.saved > 1
        ? `${result.saved} leituras salvas.`
        : 'Período salvo.',
    ...result.relinked.map(
      (other) =>
        `${other.property}: a leitura de ${formatDateRange(other)} também foi corrigida.`,
    ),
  ]
  return parts.join(' ')
}

export function PeriodSheet({ period, rows }: { period: Period; rows: Row[] }) {
  const navigate = useNavigate()
  const initialPeriod: PeriodDraft = {
    start: formatDate(period.startDate),
    end: formatDate(period.endDate),
    bill: centsToInput(period.energyBillCents),
    fund: centsToInput(period.reserveFundCents),
  }
  const [periodDraft, setPeriodDraft] = useState(initialPeriod)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [confirming, setConfirming] = useState(false)
  const save = useAction(savePeriodSheet, { success: savedMessage })
  const remove = useAction(deletePeriod, { success: 'Período apagado.' })

  const startDate = parseDate(periodDraft.start)
  const endDate = parseDate(periodDraft.end)
  const billCents =
    periodDraft.bill.trim() === '' ? null : parseCents(periodDraft.bill)
  const fundCents =
    periodDraft.fund.trim() === '' ? null : parseCents(periodDraft.fund)
  const billInvalid = periodDraft.bill.trim() !== '' && billCents === null
  const periodChanged =
    startDate !== period.startDate ||
    endDate !== period.endDate ||
    billCents !== period.energyBillCents ||
    fundCents !== period.reserveFundCents

  const priced = priceRows(
    rows.map((row) =>
      evaluate(row, drafts[row.property.id], { startDate, endDate }, period),
    ),
    billInvalid ? null : billCents,
    fundCents,
  )
  const dirty = priced.filter((item) => item.dirty)
  const unsaved = dirty.length > 0 || periodChanged
  const unusual = dirty.filter((item) => item.unusual)

  const blocker = useBlocker({
    shouldBlockFn: () => unsaved,
    enableBeforeUnload: () => unsaved,
    withResolver: true,
  })

  function updateDraft(propertyId: number, patch: Draft) {
    setDrafts((current) => ({
      ...current,
      [propertyId]: { ...current[propertyId], ...patch },
    }))
  }

  function handleSave() {
    const problem = !startDate
      ? [
          'inicio-periodo',
          'Informe a data de início do período, como 10/09/2026.',
        ]
      : !endDate
        ? ['fim-periodo', 'Informe a data final do período, como 10/10/2026.']
        : startDate >= endDate
          ? [
              'fim-periodo',
              'A data final do período precisa ser depois da inicial.',
            ]
          : billInvalid
            ? [
                'conta-energia',
                'Confira o valor da conta de energia, como 412,50.',
              ]
            : fundCents === null
              ? [
                  'fundo-reserva',
                  'Informe o fundo de reserva, como 10,00 (ou 0).',
                ]
              : null
    if (problem) {
      const [field, message] = problem
      toast.error(message)
      document.getElementById(field ?? '')?.focus()
      return
    }
    const invalid = dirty.find((item) => item.error)
    if (invalid) {
      toast.error(`${invalid.row.property.name}: ${invalid.error}`)
      document
        .querySelector<HTMLInputElement>(
          `input[data-meter="${invalid.row.property.id}"]`,
        )
        ?.focus()
      return
    }
    if (unusual.length > 0) {
      setConfirming(true)
      return
    }
    void persist()
  }

  async function persist() {
    setConfirming(false)
    if (!startDate || !endDate || fundCents === null) return
    const result = await save.run({
      data: {
        periodId: period.id,
        period: {
          startDate,
          endDate,
          energyBillCents: billCents,
          reserveFundCents: fundCents,
        },
        entries: dirty.flatMap((item) =>
          item.range && item.previous !== null && item.current !== null
            ? [
                {
                  propertyId: item.row.property.id,
                  previousReading: item.previous,
                  currentReading: item.current,
                  ...item.range,
                  meterReplaced: item.meterReplaced || undefined,
                },
              ]
            : [],
        ),
      },
    })
    if (result) setDrafts({})
  }

  const totals = summarize(priced, billInvalid ? null : billCents)
  const unread = rows.length - totals.readCount

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Período e conta de energia</CardTitle>
          <CardDescription className="text-base">
            As datas valem para todas as chácaras; uma chácara lida em outro dia
            pode ter as suas. A conta de luz da bomba é dividida pelo consumo de
            água (m³) de cada chácara.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FieldGroup className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            <FormField
              label="De"
              error={
                periodDraft.start !== '' && !startDate
                  ? 'Use o formato 10/09/2026.'
                  : undefined
              }
            >
              {(props) => (
                <DateInput
                  {...props}
                  id="inicio-periodo"
                  className="h-11 text-base sm:text-lg md:text-lg"
                  value={periodDraft.start}
                  onChange={(value) =>
                    setPeriodDraft((current) => ({ ...current, start: value }))
                  }
                />
              )}
            </FormField>
            <FormField
              label="Até"
              error={
                periodDraft.end !== '' && !endDate
                  ? 'Use o formato 10/10/2026.'
                  : startDate && endDate && startDate >= endDate
                    ? 'Precisa ser depois do início.'
                    : undefined
              }
            >
              {(props) => (
                <DateInput
                  {...props}
                  id="fim-periodo"
                  className="h-11 text-base sm:text-lg md:text-lg"
                  value={periodDraft.end}
                  onChange={(value) =>
                    setPeriodDraft((current) => ({ ...current, end: value }))
                  }
                />
              )}
            </FormField>
            <FormField
              className="col-span-2 sm:col-span-1"
              label="Conta de energia da bomba (R$)"
              description={
                billCents === null
                  ? 'Deixe em branco até a conta chegar.'
                  : undefined
              }
              error={
                billInvalid
                  ? 'Use o formato 412,50 (vírgula para os centavos).'
                  : undefined
              }
            >
              {(props) => (
                <MoneyInput
                  {...props}
                  id="conta-energia"
                  className="h-11 [&_input]:text-lg"
                  value={periodDraft.bill}
                  onChange={(value) =>
                    setPeriodDraft((current) => ({ ...current, bill: value }))
                  }
                />
              )}
            </FormField>
            <FormField
              className="col-span-2 sm:col-span-1"
              label="Fundo de reserva (R$)"
              description="Cobrado de cada chácara."
              error={
                periodDraft.fund !== '' && fundCents === null
                  ? 'Use o formato 10,00 (vírgula para os centavos).'
                  : undefined
              }
            >
              {(props) => (
                <MoneyInput
                  {...props}
                  id="fundo-reserva"
                  className="h-11 [&_input]:text-lg"
                  value={periodDraft.fund}
                  onChange={(value) =>
                    setPeriodDraft((current) => ({ ...current, fund: value }))
                  }
                />
              )}
            </FormField>
          </FieldGroup>
          <p className="rounded-lg border bg-muted/50 px-4 py-3 text-base tabular-nums">
            {totals.consumption > 0 ? (
              <>
                Água consumida no período:{' '}
                <strong>{formatNumber(totals.consumption)} m³</strong>
                {totals.priceMicros !== null && (
                  <>
                    {' '}
                    — cada m³ custou{' '}
                    <strong>{formatUnitPrice(totals.priceMicros)}</strong> de
                    energia
                  </>
                )}
                .
              </>
            ) : (
              'O consumo de água aparece aqui conforme as leituras são digitadas.'
            )}
            {billCents === null && totals.readCount > 0 && (
              <span className="block text-muted-foreground">
                Sem o valor da conta de energia, as cobranças ainda não têm
                valor.
              </span>
            )}
            {billCents !== null && unread > 0 && totals.readCount > 0 && (
              <span className="block text-muted-foreground">
                {unread === 1
                  ? 'Falta 1 chácara: os valores mudam quando a leitura dela entrar.'
                  : `Faltam ${unread} chácaras: os valores mudam quando as leituras delas entrarem.`}
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      <PeriodSummary totals={totals} chacaras={rows.length} />

      <Card className="gap-0 overflow-hidden py-0">
        <div
          aria-hidden="true"
          className={cn(
            'hidden border-b bg-muted/50 px-5 py-3 text-sm font-semibold text-muted-foreground lg:grid lg:gap-5',
            COLUMNS,
          )}
        >
          <span>Chácara</span>
          <span className="text-right">Última leitura</span>
          <span className="text-right">Leitura atual</span>
          <span className="text-right">Valor</span>
          <span>Pagamento</span>
        </div>
        <ul>
          {priced.map((item) => (
            <ReadingRow
              key={item.row.property.id}
              item={item}
              periodId={period.id}
              billKnown={billCents !== null}
              onChange={(patch) => updateDraft(item.row.property.id, patch)}
              onResetDates={() =>
                updateDraft(item.row.property.id, {
                  start: formatDate(startDate),
                  end: formatDate(endDate),
                })
              }
            />
          ))}
        </ul>
      </Card>

      <div className="flex justify-end">
        <ConfirmDialog
          title={`Apagar o período de ${formatDateRange(period)}?`}
          description={
            period.counts.readings === 0 ? (
              <p>O período não tem leituras.</p>
            ) : (
              <p>
                {period.counts.readings === 1
                  ? 'A leitura dele também será apagada'
                  : `As ${period.counts.readings} leituras dele também serão apagadas`}
                {period.counts.paid > 0 &&
                  `, com ${period.counts.paid === 1 ? 'o pagamento já registrado' : `os ${period.counts.paid} pagamentos já registrados`}`}
                . Esta ação não pode ser desfeita.
              </p>
            )
          }
          confirmLabel="Apagar período"
          onConfirm={async () => {
            const done = await remove.run({ data: { id: period.id } })
            if (!done) return
            setDrafts({})
            setPeriodDraft(initialPeriod)
            await navigate({
              to: '/',
              search: period.previousId ? { periodo: period.previousId } : {},
              ignoreBlocker: true,
            })
          }}
          trigger={
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              disabled={remove.pending}
            >
              <Trash2 aria-hidden="true" />
              Apagar este período
            </Button>
          }
        />
      </div>

      {unsaved && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-foreground px-5 py-4 text-background shadow-xl">
          <p className="font-semibold">
            Falta salvar{' '}
            {[
              periodChanged ? 'os dados do período' : null,
              dirty.length === 1
                ? '1 leitura'
                : dirty.length > 1
                  ? `${dirty.length} leituras`
                  : null,
            ]
              .filter(Boolean)
              .join(' e ')}
            .
          </p>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              className="text-background hover:bg-background/15 hover:text-background"
              onClick={() => {
                setDrafts({})
                setPeriodDraft(initialPeriod)
              }}
              disabled={save.pending}
            >
              Descartar
            </Button>
            <Button
              id="salvar-leituras"
              size="lg"
              variant="outline"
              className="border-transparent text-foreground"
              onClick={handleSave}
              disabled={save.pending}
            >
              <Check aria-hidden="true" />
              {save.pending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">
              Confira antes de salvar
            </AlertDialogTitle>
            <AlertDialogDescription asChild className="space-y-3 text-base">
              <div>
                <p>
                  {unusual.length === 1
                    ? 'Esta leitura está muito acima do consumo normal da chácara:'
                    : 'Estas leituras estão muito acima do consumo normal das chácaras:'}
                </p>
                <ul className="space-y-1">
                  {unusual.map((item) => (
                    <li key={item.row.property.id} className="tabular-nums">
                      <strong className="text-foreground">
                        {item.row.property.name}
                      </strong>
                      : {formatNumber(item.consumption ?? 0)} m³ (o normal é
                      cerca de {formatNumber(item.row.averageConsumption ?? 0)}{' '}
                      m³)
                    </li>
                  ))}
                </ul>
                <p>Um número a mais ou a menos muda muito a conta.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e conferir</AlertDialogCancel>
            <AlertDialogAction onClick={() => void persist()}>
              Salvar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blocker.status === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">
              Sair sem salvar?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Há leituras ou dados do período que ainda não foram salvos. Se
              sair agora, eles serão perdidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              Continuar aqui
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => blocker.proceed?.()}
            >
              Sair sem salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** The period's totals, as typed. */
function summarize(priced: Priced[], billCents: number | null) {
  let consumption = 0
  let readCount = 0
  let paidCount = 0
  let totalCents = 0
  let paidCents = 0
  for (const item of priced) {
    if (item.consumption === null) continue
    readCount++
    consumption += item.consumption
    totalCents += item.totalCents ?? 0
    if (item.row.reading?.paid) {
      paidCount++
      paidCents += item.totalCents ?? 0
    }
  }
  return {
    consumption,
    readCount,
    paidCount,
    totalCents,
    paidCents,
    pendingCents: totalCents - paidCents,
    priceMicros:
      billCents === null ? null : pricePerCubicMeter(billCents, consumption),
  }
}

function PeriodSummary({
  totals,
  chacaras,
}: {
  totals: ReturnType<typeof summarize>
  chacaras: number
}) {
  return (
    <section
      aria-label="Resumo do período"
      className="grid gap-6 border-y py-5 md:grid-cols-[1fr_auto] md:items-center"
    >
      <div className="flex flex-col gap-2">
        <p className="text-[1.1rem]">
          <strong>{totals.readCount}</strong> de <strong>{chacaras}</strong>{' '}
          {chacaras === 1 ? 'chácara com leitura' : 'chácaras com leitura'}
          {totals.readCount > 0 && (
            <>
              , <strong>{totals.paidCount}</strong>{' '}
              {totals.paidCount === 1 ? 'paga' : 'pagas'}
            </>
          )}
          .
        </p>
        <Progress
          aria-label="Chácaras com leitura"
          className="h-2.5 max-w-md bg-secondary"
          value={chacaras ? (totals.readCount / chacaras) * 100 : 0}
        />
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-3 tabular-nums md:gap-x-10">
        <div>
          <dt className="text-sm text-muted-foreground">Total do período</dt>
          <dd className="text-[1.35rem] font-bold">
            {formatBRL(totals.totalCents)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Já pago</dt>
          <dd className="text-[1.35rem] font-bold text-paid">
            {formatBRL(totals.paidCents)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Falta receber</dt>
          <dd className="text-[1.35rem] font-bold">
            {formatBRL(totals.pendingCents)}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function ReadingRow({
  item,
  periodId,
  billKnown,
  onChange,
  onResetDates,
}: {
  item: Priced
  periodId: number
  billKnown: boolean
  onChange: (patch: Draft) => void
  onResetDates: () => void
}) {
  const { row, error, dirty } = item
  const { property, owner, reading, previous: before } = row
  const id = useId()
  const errorId = `${id}-erro`
  const showDates = item.editingDates

  return (
    <li
      className={cn(
        'grid gap-4 border-b p-5 last:border-b-0 sm:grid-cols-2 lg:items-start lg:gap-5',
        COLUMNS,
      )}
    >
      <div className="flex items-start gap-3 sm:col-span-2 lg:col-span-1">
        <PropertyPlate name={property.name} />
        <div className="min-w-0">
          <Link
            to="/chacaras/$id"
            params={{ id: String(property.id) }}
            className="text-[1.1rem] font-bold hover:underline"
          >
            {property.name}
          </Link>
          <p className="text-muted-foreground">
            {owner?.name ?? 'Sem proprietário'}
          </p>
          {property.meterNumber && (
            <p className="text-sm text-muted-foreground">
              Hidrômetro {property.meterNumber}
            </p>
          )}
          {item.ownDates && (
            <p className="mt-1 text-sm font-semibold text-primary tabular-nums">
              {item.range
                ? `Datas desta chácara: ${formatDateRange(item.range)}`
                : 'Confira as datas desta chácara.'}
            </p>
          )}
          {!showDates && (
            <Button
              variant="link"
              size="sm"
              className="h-auto gap-1.5 px-0 py-0.5 text-muted-foreground has-[>svg]:px-0"
              onClick={() => onChange({ editingDates: true })}
            >
              <CalendarDays aria-hidden="true" />
              {item.ownDates ? 'Alterar as datas' : 'Datas diferentes?'}
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <Label
          htmlFor={`${id}-anterior`}
          className="text-muted-foreground lg:sr-only"
        >
          Última leitura
          <span className="sr-only"> de {property.name}</span>
        </Label>
        <MeterInput
          id={`${id}-anterior`}
          look="plain"
          className="h-11 text-right text-[1.2rem] tabular-nums md:text-[1.2rem]"
          value={item.previousText}
          aria-invalid={
            (Boolean(error) && item.previous === null) ||
            (item.meterQuestion && !item.meterReplaced)
          }
          onChange={(value) => onChange({ previous: value })}
        />
        <p className="text-sm text-muted-foreground lg:text-right">
          {before
            ? `em ${formatDate(before.endDate)}`
            : reading
              ? 'primeira leitura'
              : 'primeira leitura: digite o número'}
        </p>
        {item.correctsPrevious && before && (
          <p className="text-sm font-semibold text-primary lg:text-right">
            Corrige também a leitura de {formatDateRange(before)} (era{' '}
            {formatNumber(before.currentReading)}).
          </p>
        )}
        {item.meterQuestion && (
          <div className="flex items-start gap-2 lg:justify-end">
            <Checkbox
              id={`${id}-troca`}
              checked={item.meterReplaced}
              onCheckedChange={(checked) =>
                onChange({ meterReplaced: checked === true })
              }
            />
            <Label htmlFor={`${id}-troca`} className="text-sm leading-snug">
              Hidrômetro trocado
            </Label>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <Label
          htmlFor={`${id}-atual`}
          className="text-muted-foreground lg:sr-only"
        >
          Leitura atual
          <span className="sr-only"> de {property.name}</span>
        </Label>
        <MeterInput
          id={`${id}-atual`}
          data-meter={property.id}
          enterKeyHint="next"
          dirty={dirty}
          value={item.currentText}
          aria-invalid={Boolean(error)}
          aria-describedby={error || item.unusual ? errorId : undefined}
          onChange={(value) => onChange({ current: value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              focusNextMeter(event.currentTarget)
            }
          }}
        />
        {error ? (
          <p id={errorId} className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : (
          item.unusual && (
            <p id={errorId} className="text-sm font-semibold text-pending">
              Muito acima do normal (cerca de{' '}
              {formatNumber(row.averageConsumption ?? 0)} m³). Confira o número.
            </p>
          )
        )}
      </div>

      <div className="tabular-nums sm:col-span-2 lg:col-span-1 lg:text-right">
        {item.consumption !== null ? (
          <>
            <p className="text-sm text-muted-foreground">
              {formatNumber(item.consumption)} m³ de água
              {item.energyCents !== null && ` = ${formatBRL(item.energyCents)}`}
            </p>
            {item.totalCents !== null && item.fundCents !== null ? (
              <>
                <p className="text-sm text-muted-foreground">
                  + fundo de reserva {formatBRL(item.fundCents)}
                </p>
                <p className="text-[1.3rem] font-bold">
                  {formatBRL(item.totalCents)}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aguardando a conta de energia.
              </p>
            )}
          </>
        ) : (
          <p className="hidden text-muted-foreground lg:block">—</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1">
        {reading && !dirty ? (
          reading.bill.totalCents === null ? (
            <p className="text-sm text-muted-foreground">
              {billKnown
                ? 'Salve para calcular a cobrança.'
                : 'Cobrança quando a conta de energia for informada.'}
            </p>
          ) : (
            <>
              <StatusBadge paid={reading.paid} paidAt={reading.paidAt} />
              <div className="flex flex-wrap gap-1">
                <PaidToggle readingId={reading.id} paid={reading.paid} />
                <Button variant="ghost" size="sm" asChild>
                  <Link
                    to="/relatorios/periodo"
                    search={{ periodo: periodId, chacara: property.id }}
                  >
                    <FileText aria-hidden="true" />
                    Cobrança
                  </Link>
                </Button>
              </div>
            </>
          )
        ) : (
          <p
            className={cn(
              'text-sm',
              dirty ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {dirty ? 'Salve a leitura para cobrar.' : 'Aguardando leitura.'}
          </p>
        )}
      </div>

      {showDates && (
        <fieldset className="flex flex-wrap items-end gap-4 rounded-lg border bg-muted/40 p-4 sm:col-span-2 lg:col-span-full">
          <legend className="sr-only">Datas de {property.name}</legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-inicio`}>Última leitura em</Label>
            <DateInput
              id={`${id}-inicio`}
              className="h-10 w-36 bg-background"
              value={item.startText}
              onChange={(value) => onChange({ start: value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-fim`}>Leitura atual em</Label>
            <DateInput
              id={`${id}-fim`}
              className="h-10 w-36 bg-background"
              value={item.endText}
              onChange={(value) => onChange({ end: value })}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {item.ownDates && (
              <Button variant="outline" size="sm" onClick={onResetDates}>
                Usar as datas do período
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ editingDates: false })}
            >
              Fechar
            </Button>
          </div>
          {before && (
            <p className="basis-full text-sm text-muted-foreground">
              A data da última leitura é a da leitura de{' '}
              {formatDateRange(before)}: mudar uma muda a outra.
            </p>
          )}
        </fieldset>
      )}
    </li>
  )
}
