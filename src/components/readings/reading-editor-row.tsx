import { cn } from 'cn'
import { Check, X } from 'lucide-react'
import { type ChangeEvent, type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { FormField, MeterInput, MoneyInput } from '#/components/form'
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
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { FieldGroup } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { TableCell, TableRow } from '#/components/ui/table'
import { computeBill } from '#/lib/billing'
import {
  centsToInput,
  formatBRL,
  formatKwhPrice,
  formatNumber,
  microsToInput,
  parseCents,
  parsePriceMicros,
} from '#/lib/money'
import { MONTH_NAMES, type Period } from '#/lib/periods'

export interface ReadingValues {
  year: number
  month: number
  previousReading: number
  currentReading: number
  kwhPriceMicros: number
  reserveFundCents: number
  paid: boolean
  /** The person confirmed a "leitura anterior" off the chain (new meter). */
  confirmPreviousChange?: boolean
}

/** The reading that "leitura anterior" should repeat, if there is one. */
export type ExpectedPrevious = (
  period: Period,
) => { value: number; label: string } | null

export interface ReadingDraft {
  year: string
  month: string
  previous: string
  current: string
  price: string
  fund: string
  status: 'pago' | 'pendente'
}

export function toDraft(values: {
  year: number
  month: number
  previousReading: number | null
  currentReading: number | null
  kwhPriceMicros: number | null
  reserveFundCents: number | null
  paid: boolean
}): ReadingDraft {
  return {
    year: String(values.year),
    month: String(values.month),
    previous:
      values.previousReading === null ? '' : String(values.previousReading),
    current:
      values.currentReading === null ? '' : String(values.currentReading),
    price: microsToInput(values.kwhPriceMicros),
    fund: centsToInput(values.reserveFundCents),
    status: values.paid ? 'pago' : 'pendente',
  }
}

/** Turns the typed text into numbers, or explains the first problem found. */
function parseDraft(
  draft: ReadingDraft,
): { values: ReadingValues } | { error: string; field: keyof ReadingDraft } {
  const year = Number(draft.year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    return { error: 'Informe um ano válido, como 2026.', field: 'year' }
  if (draft.current === '')
    return { error: 'Informe a leitura atual.', field: 'current' }
  if (draft.previous === '')
    return { error: 'Informe a leitura anterior.', field: 'previous' }
  const currentReading = Number(draft.current)
  const previousReading = Number(draft.previous)
  if (currentReading < previousReading)
    return {
      error: 'A leitura atual não pode ser menor que a anterior.',
      field: 'current',
    }
  const kwhPriceMicros = parsePriceMicros(draft.price)
  if (kwhPriceMicros === null)
    return { error: 'Informe o preço do kWh, como 0,85.', field: 'price' }
  const reserveFundCents = parseCents(draft.fund)
  if (reserveFundCents === null)
    return { error: 'Informe o fundo de reserva, como 10,00.', field: 'fund' }
  return {
    values: {
      year,
      month: Number(draft.month),
      previousReading,
      currentReading,
      kwhPriceMicros,
      reserveFundCents,
      paid: draft.status === 'pago',
    },
  }
}

/** Draft state shared by the inline editor and the "Nova leitura" form. */
function useReadingDraft(
  initial: ReadingDraft,
  expectedPrevious: ExpectedPrevious,
  /** Editing only asks about the previous reading if it was changed. */
  onlyIfChanged: boolean,
) {
  const [draft, setDraft] = useState(initial)
  const [invalidField, setInvalidField] = useState<keyof ReadingDraft | null>(
    null,
  )
  const parsed = parseDraft(draft)
  const bill = 'values' in parsed ? computeBill(parsed.values) : null
  const expected =
    'values' in parsed
      ? expectedPrevious({
          year: parsed.values.year,
          month: parsed.values.month,
        })
      : null
  /** "Leitura anterior" differs from the month before: needs a confirm. */
  const offChain =
    'values' in parsed &&
    expected !== null &&
    parsed.values.previousReading !== expected.value &&
    (!onlyIfChanged || draft.previous !== initial.previous)

  function set<K extends keyof ReadingDraft>(key: K, value: ReadingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    if (invalidField === key) setInvalidField(null)
  }

  /** Props for the plain number inputs (year, readings). */
  function digits(key: 'previous' | 'current' | 'year') {
    return {
      value: draft[key],
      inputMode: 'numeric' as const,
      autoComplete: 'off',
      'aria-invalid': invalidField === key,
      onChange: (event: ChangeEvent<HTMLInputElement>) =>
        set(key, event.target.value.replace(/\D/g, '')),
    }
  }

  /** Returns the values, or shows what is missing and returns null. */
  function validate(): ReadingValues | null {
    if ('error' in parsed) {
      setInvalidField(parsed.field)
      toast.error(parsed.error)
      return null
    }
    return parsed.values
  }

  return {
    draft,
    set,
    digits,
    bill,
    parsed,
    invalidField,
    validate,
    expected,
    offChain,
  }
}

/** Asks before saving a "leitura anterior" that breaks the chain. */
function ChainConfirmDialog({
  pending,
  expected,
  onCancel,
  onConfirm,
}: {
  pending: ReadingValues | null
  expected: { value: number; label: string } | null
  onCancel: () => void
  onConfirm: (values: ReadingValues) => void
}) {
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => !open && onCancel()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl">
            Confira a leitura anterior
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-base">
              <p>
                A leitura anterior digitada (
                <strong className="text-foreground tabular-nums">
                  {formatNumber(pending?.previousReading ?? 0)}
                </strong>
                ) é diferente da leitura de {expected?.label} (
                <strong className="text-foreground tabular-nums">
                  {formatNumber(expected?.value ?? 0)}
                </strong>
                ).
              </p>
              <p>
                Isso só acontece quando o hidrômetro é trocado ou zerado. Um
                número errado aqui aumenta muito a conta.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar e corrigir</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              pending && onConfirm({ ...pending, confirmPreviousChange: true })
            }
          >
            Salvar mesmo assim
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function MonthSelect({
  value,
  onChange,
  ...props
}: {
  value: string
  onChange: (value: string) => void
} & Omit<React.ComponentProps<'select'>, 'value' | 'onChange' | 'size'>) {
  return (
    <NativeSelect
      {...props}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {MONTH_NAMES.map((name, index) => (
        <NativeSelectOption key={name} value={index + 1}>
          {name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}

function StatusSelect({
  value,
  onChange,
  ...props
}: {
  value: ReadingDraft['status']
  onChange: (value: ReadingDraft['status']) => void
} & Omit<React.ComponentProps<'select'>, 'value' | 'onChange' | 'size'>) {
  return (
    <NativeSelect
      {...props}
      value={value}
      onChange={(event) =>
        onChange(event.target.value as ReadingDraft['status'])
      }
    >
      <NativeSelectOption value="pendente">Pendente</NativeSelectOption>
      <NativeSelectOption value="pago">Pago</NativeSelectOption>
    </NativeSelect>
  )
}

/**
 * One spreadsheet row in edit mode: the same columns as the table, with the
 * computed ones (consumo, custo, total) updating while typing.
 */
export function ReadingEditorRow({
  initial,
  label,
  expectedPrevious,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: ReadingDraft
  /** Describes the row for screen readers, e.g. "Outubro de 2026". */
  label: string
  expectedPrevious: ExpectedPrevious
  pending: boolean
  onSubmit: (values: ReadingValues) => Promise<boolean>
  onCancel: () => void
}) {
  const {
    draft,
    set,
    digits,
    bill,
    invalidField,
    validate,
    expected,
    offChain,
  } = useReadingDraft(initial, expectedPrevious, true)
  const [confirming, setConfirming] = useState<ReadingValues | null>(null)

  async function submit() {
    const values = validate()
    if (!values) return
    if (offChain) setConfirming(values)
    else await onSubmit(values)
  }

  return (
    <TableRow
      className="bg-secondary/60 hover:bg-secondary/60"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault()
          void submit()
        }
        if (event.key === 'Escape') onCancel()
      }}
    >
      <TableCell>
        <Input
          {...digits('year')}
          aria-label={`Ano (${label})`}
          maxLength={4}
          className="w-[4.5rem] tabular-nums"
        />
      </TableCell>
      <TableCell>
        <MonthSelect
          aria-label={`Mês (${label})`}
          value={draft.month}
          onChange={(value) => set('month', value)}
        />
      </TableCell>
      <TableCell>
        <Input
          {...digits('current')}
          aria-label={`Leitura atual (${label})`}
          maxLength={9}
          className="w-[6.5rem] text-right tabular-nums"
        />
      </TableCell>
      <TableCell>
        <Input
          {...digits('previous')}
          aria-label={`Leitura anterior (${label})`}
          title={
            offChain && expected
              ? `Diferente de ${expected.label} (${formatNumber(expected.value)})`
              : undefined
          }
          maxLength={9}
          className={cn(
            'w-[6.5rem] text-right tabular-nums',
            offChain && 'border-pending ring-2 ring-pending/30',
          )}
        />
        <ChainConfirmDialog
          pending={confirming}
          expected={expected}
          onCancel={() => setConfirming(null)}
          onConfirm={(values) => {
            setConfirming(null)
            void onSubmit(values)
          }}
        />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {bill ? formatNumber(bill.consumption) : '—'}
      </TableCell>
      <TableCell>
        <MoneyInput
          kind="price"
          aria-label={`Preço do kWh (${label})`}
          aria-invalid={invalidField === 'price'}
          className="w-[7.5rem]"
          value={draft.price}
          onChange={(value) => set('price', value)}
        />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {bill ? formatBRL(bill.energyCents) : '—'}
      </TableCell>
      <TableCell>
        <MoneyInput
          aria-label={`Fundo de reserva (${label})`}
          aria-invalid={invalidField === 'fund'}
          className="w-[7rem]"
          value={draft.fund}
          onChange={(value) => set('fund', value)}
        />
      </TableCell>
      <TableCell className="text-right font-bold tabular-nums">
        {bill ? formatBRL(bill.totalCents) : '—'}
      </TableCell>
      <TableCell>
        <StatusSelect
          aria-label={`Situação (${label})`}
          value={draft.status}
          onChange={(value) => set('status', value)}
        />
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button size="sm" disabled={pending} onClick={() => void submit()}>
            <Check aria-hidden="true" />
            Salvar
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={pending}
            onClick={onCancel}
            aria-label="Cancelar"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

/**
 * "Nova leitura" below the spreadsheet: the same fields as a row, with
 * labels, and the bill calculated while typing.
 */
export function NewReadingForm({
  initial,
  expectedPrevious,
  pending,
  onSubmit,
}: {
  initial: ReadingDraft
  expectedPrevious: ExpectedPrevious
  pending: boolean
  onSubmit: (values: ReadingValues) => Promise<boolean>
}) {
  const {
    draft,
    set,
    digits,
    bill,
    parsed,
    invalidField,
    validate,
    expected,
    offChain,
  } = useReadingDraft(initial, expectedPrevious, false)
  const [confirming, setConfirming] = useState<ReadingValues | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const values = validate()
    if (!values) return
    if (offChain) setConfirming(values)
    else await onSubmit(values)
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle className="text-xl">Nova leitura</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            <FormField label="Ano">
              {(props) => (
                <Input
                  {...props}
                  {...digits('year')}
                  maxLength={4}
                  className="tabular-nums"
                />
              )}
            </FormField>
            <FormField label="Mês">
              {(props) => (
                <MonthSelect
                  {...props}
                  value={draft.month}
                  onChange={(value) => set('month', value)}
                />
              )}
            </FormField>
            <FormField label="Leitura anterior">
              {(props) => (
                <Input
                  {...props}
                  {...digits('previous')}
                  maxLength={9}
                  className={cn(
                    'text-right tabular-nums',
                    offChain && 'border-pending ring-2 ring-pending/30',
                  )}
                />
              )}
            </FormField>
            <FormField label="Leitura atual">
              {(props) => (
                <MeterInput
                  {...props}
                  aria-invalid={invalidField === 'current'}
                  className="min-h-9 text-[1.25rem] md:text-[1.25rem]"
                  value={draft.current}
                  onChange={(value) => set('current', value)}
                />
              )}
            </FormField>
            <FormField label="Preço kWh">
              {(props) => (
                <MoneyInput
                  {...props}
                  kind="price"
                  aria-invalid={invalidField === 'price'}
                  value={draft.price}
                  onChange={(value) => set('price', value)}
                />
              )}
            </FormField>
            <FormField label="Fundo reserva">
              {(props) => (
                <MoneyInput
                  {...props}
                  aria-invalid={invalidField === 'fund'}
                  value={draft.fund}
                  onChange={(value) => set('fund', value)}
                />
              )}
            </FormField>
            <FormField label="Situação">
              {(props) => (
                <StatusSelect
                  {...props}
                  value={draft.status}
                  onChange={(value) => set('status', value)}
                />
              )}
            </FormField>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-4">
          {offChain && expected && (
            <p className="basis-full font-semibold text-pending">
              A leitura anterior está diferente da leitura de {expected.label} (
              {formatNumber(expected.value)}). Só mude se o hidrômetro foi
              trocado.
            </p>
          )}
          <p className="text-muted-foreground tabular-nums" aria-live="polite">
            {bill && 'values' in parsed ? (
              <>
                {formatNumber(bill.consumption)} kWh ×{' '}
                {formatKwhPrice(parsed.values.kwhPriceMicros)} ={' '}
                {formatBRL(bill.energyCents)}, mais fundo de{' '}
                {formatBRL(bill.reserveFundCents)}:{' '}
                <strong className="text-lg text-foreground">
                  {formatBRL(bill.totalCents)}
                </strong>
              </>
            ) : (
              'Digite a leitura atual para ver o valor.'
            )}
          </p>
          <Button type="submit" size="lg" disabled={pending}>
            <Check aria-hidden="true" />
            {pending ? 'Salvando…' : 'Adicionar leitura'}
          </Button>
        </CardFooter>
      </form>
      <ChainConfirmDialog
        pending={confirming}
        expected={expected}
        onCancel={() => setConfirming(null)}
        onConfirm={(values) => {
          setConfirming(null)
          void onSubmit(values)
        }}
      />
    </Card>
  )
}
