import { Link, useBlocker } from '@tanstack/react-router'
import { cn } from 'cn'
import { Check, FileText } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { FormField, MeterInput, MoneyInput } from '#/components/form'
import { PropertyPlate } from '#/components/property-plate'
import { PaidToggle } from '#/components/readings/paid-toggle'
import { PriceCalculator } from '#/components/readings/price-calculator'
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
import { FieldGroup } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { type Bill, computeBill, isUnusualConsumption } from '#/lib/billing'
import {
  centsToInput,
  formatBRL,
  formatKwhPrice,
  formatNumber,
  microsToInput,
  parseCents,
  parsePriceMicros,
} from '#/lib/money'
import { formatPeriod, type Period } from '#/lib/periods'
import { useAction } from '#/lib/use-action'
import { saveMonthReadings } from '#/server/readings.functions'
import type { MonthSheet as MonthSheetData } from '#/server/readings.server'

type Row = MonthSheetData['rows'][number]
type Rates = MonthSheetData['rates']

/** Chácara, Leitura atual, Valor, Pagamento: the header and every row. */
const COLUMNS =
  'lg:grid-cols-[minmax(15rem,1.4fr)_minmax(9rem,0.85fr)_minmax(13rem,1.15fr)_minmax(14rem,1.2fr)]'

interface MonthValues {
  kwhPriceMicros: number
  reserveFundCents: number
}

interface Draft {
  current?: string
  previous?: string
}

interface Evaluated {
  row: Row
  currentText: string
  previousText: string
  /** First reading of the chácara: the previous value must be typed too. */
  needsPrevious: boolean
  previous: number | null
  current: number | null
  dirty: boolean
  error: string | null
  bill: Bill | null
  kwhPriceMicros: number | null
  /** Far above the recent average: probably a typo. */
  unusual: boolean
}

function evaluate(
  row: Row,
  draft: Draft | undefined,
  /** The month's values as typed (null while incomplete). */
  values: MonthValues | null,
): Evaluated {
  const saved = row.reading?.currentReading
  const savedText = saved === undefined ? '' : String(saved)
  const currentText = draft?.current ?? savedText
  const previousText = draft?.previous ?? ''
  const needsPrevious = !row.reading && row.suggestedPreviousReading === null

  const previous =
    row.reading?.previousReading ??
    row.suggestedPreviousReading ??
    (previousText === '' ? null : Number(previousText))
  const current = currentText === '' ? null : Number(currentText)
  const dirty =
    currentText !== savedText || (needsPrevious && previousText !== '')

  let error: string | null = null
  if (dirty) {
    if (current === null) error = 'Informe a leitura atual.'
    else if (previous === null) error = 'Informe a leitura anterior.'
    else if (current < previous)
      error = `Menor que a leitura anterior (${formatNumber(previous)}).`
  }

  // Paid bills keep what was charged; the others follow the month's values.
  const charged = row.reading?.paid ? row.reading : (values ?? row.reading)
  const kwhPriceMicros = charged?.kwhPriceMicros ?? null
  const reserveFundCents = charged?.reserveFundCents ?? null
  const bill =
    !error &&
    current !== null &&
    previous !== null &&
    current >= previous &&
    kwhPriceMicros !== null &&
    reserveFundCents !== null
      ? computeBill({
          previousReading: previous,
          currentReading: current,
          kwhPriceMicros,
          reserveFundCents,
        })
      : null

  return {
    row,
    currentText,
    previousText,
    needsPrevious,
    previous,
    current,
    dirty,
    error,
    bill,
    kwhPriceMicros,
    unusual:
      bill !== null &&
      isUnusualConsumption(bill.consumption, row.averageConsumption),
  }
}

/** Moves the cursor to the next reading, like pressing Enter in a spreadsheet. */
function focusNextMeter(from: HTMLElement) {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[data-meter]'),
  )
  const next = inputs[inputs.indexOf(from as HTMLInputElement) + 1]
  if (next) next.focus()
  else document.getElementById('salvar-leituras')?.focus()
}

function savedMessage({
  saved,
  repriced,
}: {
  saved: number
  repriced: number
}) {
  const parts = [
    saved === 1
      ? '1 leitura salva.'
      : saved > 1
        ? `${saved} leituras salvas.`
        : '',
    repriced === 1
      ? '1 cobrança em aberto foi recalculada.'
      : repriced > 1
        ? `${repriced} cobranças em aberto foram recalculadas.`
        : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : 'Valores do mês salvos.'
}

export function MonthSheet({
  period,
  rows,
  rates,
}: {
  period: Period
  rows: Row[]
  rates: Rates
}) {
  const savedPrice = rates?.kwhPriceMicros ?? null
  const savedFund = rates?.reserveFundCents ?? null
  const initialValues = {
    price: microsToInput(savedPrice),
    fund: centsToInput(savedFund),
  }
  const [valuesDraft, setValuesDraft] = useState(initialValues)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [confirmingUnusual, setConfirmingUnusual] = useState(false)
  const save = useAction(saveMonthReadings, { success: savedMessage })

  const price =
    valuesDraft.price === '' ? null : parsePriceMicros(valuesDraft.price)
  const fund = valuesDraft.fund === '' ? null : parseCents(valuesDraft.fund)
  const monthValues =
    price !== null && fund !== null
      ? { kwhPriceMicros: price, reserveFundCents: fund }
      : null
  const valuesChanged = price !== savedPrice || fund !== savedFund

  const evaluated = rows.map((row) =>
    evaluate(row, drafts[row.property.id], monthValues),
  )
  const dirty = evaluated.filter((item) => item.dirty)
  const unsaved = dirty.length > 0 || valuesChanged

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

  const unusual = dirty.filter((item) => item.unusual)

  function handleSave() {
    if (!monthValues) {
      toast.error(
        'Informe o preço do kWh e o fundo de reserva deste mês, como 0,85 e 10,00.',
      )
      document
        .getElementById(price === null ? 'preco-kwh' : 'fundo-reserva')
        ?.focus()
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
      setConfirmingUnusual(true)
      return
    }
    void persist()
  }

  async function persist() {
    setConfirmingUnusual(false)
    if (!monthValues) return
    const result = await save.run({
      data: {
        ...period,
        rates: monthValues,
        entries: dirty.map((item) => ({
          propertyId: item.row.property.id,
          currentReading: item.current ?? 0,
          previousReading:
            item.needsPrevious && item.previous !== null
              ? item.previous
              : undefined,
        })),
      },
    })
    if (result) setDrafts({})
  }

  const hint = rates?.saved
    ? 'Se mudar, as cobranças em aberto deste mês são recalculadas; as já pagas não mudam.'
    : rates?.suggestedFrom
      ? `Mesmos valores de ${formatPeriod(rates.suggestedFrom)}. Altere se a conta de luz mudou.`
      : 'Informe o preço do kWh e o fundo de reserva para calcular as cobranças.'

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            Valores de {formatPeriod(period)}
          </CardTitle>
          <CardDescription className="text-base">{hint}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FieldGroup className="grid gap-5 sm:grid-cols-2 lg:max-w-2xl">
            <FormField
              label="Preço do kWh (R$)"
              error={
                valuesDraft.price !== '' && price === null
                  ? 'Use o formato 0,85 (vírgula para os centavos).'
                  : undefined
              }
            >
              {(props) => (
                <MoneyInput
                  {...props}
                  id="preco-kwh"
                  kind="price"
                  className="h-11 [&_input]:text-lg"
                  value={valuesDraft.price}
                  onChange={(value) =>
                    setValuesDraft((current) => ({ ...current, price: value }))
                  }
                />
              )}
            </FormField>
            <FormField
              label="Fundo de reserva (R$)"
              description="Cobrado de cada chácara."
              error={
                valuesDraft.fund !== '' && fund === null
                  ? 'Use o formato 10,00 (vírgula para os centavos).'
                  : undefined
              }
            >
              {(props) => (
                <MoneyInput
                  {...props}
                  id="fundo-reserva"
                  className="h-11 [&_input]:text-lg"
                  value={valuesDraft.fund}
                  onChange={(value) =>
                    setValuesDraft((current) => ({ ...current, fund: value }))
                  }
                />
              )}
            </FormField>
          </FieldGroup>
          <PriceCalculator
            onUse={(micros) => {
              setValuesDraft((current) => ({
                ...current,
                price: microsToInput(micros),
              }))
              toast.info(
                `Preço ${formatKwhPrice(micros)} colocado. Clique em “Salvar” para usar.`,
              )
            }}
          />
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <div
          aria-hidden="true"
          className={cn(
            'hidden border-b bg-muted/50 px-5 py-3 text-sm font-semibold text-muted-foreground lg:grid lg:gap-5',
            COLUMNS,
          )}
        >
          <span>Chácara</span>
          <span className="text-right">Leitura atual</span>
          <span className="text-right">Valor</span>
          <span>Pagamento</span>
        </div>
        <ul>
          {evaluated.map((item) => (
            <ReadingRow
              key={item.row.property.id}
              item={item}
              period={period}
              onChange={(patch) => updateDraft(item.row.property.id, patch)}
            />
          ))}
        </ul>
      </Card>

      {unsaved && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-foreground px-5 py-4 text-background shadow-xl">
          <p className="font-semibold">
            Falta salvar{' '}
            {[
              valuesChanged ? 'os valores do mês' : null,
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
                setValuesDraft(initialValues)
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

      <AlertDialog open={confirmingUnusual} onOpenChange={setConfirmingUnusual}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">
              Confira antes de salvar
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-base">
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
                      : {formatNumber(item.bill?.consumption ?? 0)} kWh (o
                      normal é cerca de{' '}
                      {formatNumber(item.row.averageConsumption ?? 0)} kWh)
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
              Há leituras ou valores digitados que ainda não foram salvos. Se
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

function ReadingRow({
  item,
  period,
  onChange,
}: {
  item: Evaluated
  period: Period
  onChange: (patch: Draft) => void
}) {
  const { row, bill, error, dirty } = item
  const { property, owner, reading } = row
  const errorId = `erro-leitura-${property.id}`

  return (
    <li
      className={cn(
        'grid gap-4 border-b p-5 last:border-b-0 lg:items-center lg:gap-5',
        COLUMNS,
      )}
    >
      <div className="flex items-start gap-3">
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
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:max-w-xs lg:max-w-none">
        {/* The first reading of a chácara has nothing before it to go on. */}
        {item.needsPrevious && (
          <div className="flex flex-col gap-1 lg:items-end">
            <Label
              htmlFor={`anterior-${property.id}`}
              className="flex-col items-start gap-0 text-muted-foreground lg:items-end"
            >
              Leitura anterior
              <span className="font-normal">primeira leitura</span>
            </Label>
            <Input
              id={`anterior-${property.id}`}
              className="h-11 text-right text-[1.2rem] tabular-nums md:text-[1.2rem]"
              inputMode="numeric"
              autoComplete="off"
              maxLength={9}
              value={item.previousText}
              aria-invalid={Boolean(error) && item.previous === null}
              onChange={(event) =>
                onChange({ previous: event.target.value.replace(/\D/g, '') })
              }
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Label
            htmlFor={`atual-${property.id}`}
            className={cn(
              'text-muted-foreground',
              item.needsPrevious ? 'lg:self-end' : 'lg:sr-only',
            )}
          >
            Leitura atual
            <span className="sr-only"> de {property.name}</span>
          </Label>
          <MeterInput
            id={`atual-${property.id}`}
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
                {formatNumber(row.averageConsumption ?? 0)} kWh). Confira o
                número.
              </p>
            )
          )}
        </div>
      </div>

      <div className="tabular-nums lg:text-right">
        {bill && item.kwhPriceMicros !== null ? (
          <>
            <p className="text-sm text-muted-foreground">
              {formatNumber(bill.consumption)} kWh ×{' '}
              {formatKwhPrice(item.kwhPriceMicros)} ={' '}
              {formatBRL(bill.energyCents)}
            </p>
            <p className="text-sm text-muted-foreground">
              + fundo de reserva {formatBRL(bill.reserveFundCents)}
            </p>
            <p className="text-[1.3rem] font-bold">
              {formatBRL(bill.totalCents)}
            </p>
          </>
        ) : (
          <p className="hidden text-muted-foreground lg:block">—</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {reading && !dirty ? (
          <PaymentActions
            readingId={reading.id}
            paid={reading.paid}
            paidAt={reading.paidAt}
            period={period}
            propertyId={property.id}
          />
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
    </li>
  )
}

function PaymentActions({
  readingId,
  paid,
  paidAt,
  period,
  propertyId,
}: {
  readingId: number
  paid: boolean
  paidAt: string | null
  period: Period
  propertyId: number
}) {
  return (
    <>
      <StatusBadge paid={paid} paidAt={paidAt} />
      <div className="flex flex-wrap gap-1">
        <PaidToggle readingId={readingId} paid={paid} />
        <Button variant="ghost" size="sm" asChild>
          <Link
            to="/relatorios/mensal"
            search={{
              ano: period.year,
              mes: period.month,
              chacara: propertyId,
            }}
          >
            <FileText aria-hidden="true" />
            Cobrança
          </Link>
        </Button>
      </div>
    </>
  )
}
