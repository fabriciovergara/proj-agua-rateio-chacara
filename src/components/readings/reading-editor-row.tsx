import { Check, X } from 'lucide-react'
import { type ChangeEvent, type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'
import { DateInput, FormField, MeterInput } from '#/components/form'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { FieldGroup } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { TableCell, TableRow } from '#/components/ui/table'
import { formatNumber } from '#/lib/money'
import {
  type DateRange,
  formatDate,
  formatDateRange,
  parseDate,
} from '#/lib/periods'

export interface ReadingValues {
  previousReading: number
  currentReading: number
  startDate: string
  endDate: string
  paid: boolean
  /** The meter was replaced: the reading before stays as it is. */
  meterReplaced?: boolean
}

/** The chácara's reading before this one: what "Última leitura" repeats. */
export type Before = DateRange & {
  previousReading: number
  currentReading: number
}

export interface ReadingDraft {
  start: string
  end: string
  previous: string
  current: string
  status: 'pago' | 'pendente'
  meterReplaced: boolean
}

export function toDraft(values: {
  startDate: string
  endDate: string
  previousReading: number | null
  currentReading: number | null
  paid: boolean
}): ReadingDraft {
  return {
    start: formatDate(values.startDate),
    end: formatDate(values.endDate),
    previous:
      values.previousReading === null ? '' : String(values.previousReading),
    current:
      values.currentReading === null ? '' : String(values.currentReading),
    status: values.paid ? 'pago' : 'pendente',
    meterReplaced: false,
  }
}

type Field = 'start' | 'end' | 'previous' | 'current'

/**
 * Turns the typed text into values, or explains the first problem found.
 * `linked`: the reading before follows "Última leitura" (same meter).
 */
function parseDraft(
  draft: ReadingDraft,
  before: Before | null,
  linked: boolean,
) {
  const startDate = parseDate(draft.start)
  const endDate = parseDate(draft.end)
  const previous = draft.previous === '' ? null : Number(draft.previous)
  const current = draft.current === '' ? null : Number(draft.current)
  const corrects =
    before !== null &&
    linked &&
    previous !== null &&
    previous !== before.currentReading
  const meterQuestion =
    corrects && previous !== null && previous < (before?.previousReading ?? 0)

  const fail = (error: string, field: Field) => ({
    error,
    field,
    corrects,
    meterQuestion,
  })
  if (!startDate) return fail('Informe a data da última leitura.', 'start')
  if (!endDate) return fail('Informe a data da leitura.', 'end')
  if (startDate >= endDate)
    return fail('A data da leitura precisa ser depois da última.', 'end')
  if (previous === null) return fail('Informe a última leitura.', 'previous')
  if (current === null) return fail('Informe a leitura atual.', 'current')
  if (current < previous)
    return fail('A leitura atual não pode ser menor que a última.', 'current')
  if (meterQuestion && !draft.meterReplaced)
    return fail(
      `A última leitura é menor que a anterior a ela (${formatNumber(before?.previousReading ?? 0)}). Confira o número ou marque “Hidrômetro trocado”.`,
      'previous',
    )
  return {
    values: {
      startDate,
      endDate,
      previousReading: previous,
      currentReading: current,
      paid: draft.status === 'pago',
      meterReplaced: (meterQuestion && draft.meterReplaced) || undefined,
    } satisfies ReadingValues,
    corrects: corrects && !meterQuestion,
    meterQuestion,
  }
}

/** Draft state shared by the inline editor and the "Nova leitura" form. */
function useReadingDraft(
  initial: ReadingDraft,
  before: Before | null,
  linked: boolean,
) {
  const [draft, setDraft] = useState(initial)
  const [invalidField, setInvalidField] = useState<Field | null>(null)
  const parsed = parseDraft(draft, before, linked)
  const consumption =
    'values' in parsed
      ? parsed.values.currentReading - parsed.values.previousReading
      : null

  function set<K extends keyof ReadingDraft>(key: K, value: ReadingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    if (invalidField === key) setInvalidField(null)
  }

  /** Props for the plain number inputs. */
  function digits(key: 'previous' | 'current') {
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
    setDraft,
    digits,
    consumption,
    invalidField,
    validate,
    corrects: parsed.corrects,
    meterQuestion: parsed.meterQuestion,
  }
}

/** Under "Última leitura": what saving it also changes, or the meter question. */
function ChainNote({
  before,
  corrects,
  meterQuestion,
  meterReplaced,
  onMeterReplaced,
}: {
  before: Before | null
  corrects: boolean
  meterQuestion: boolean
  meterReplaced: boolean
  onMeterReplaced: (value: boolean) => void
}) {
  const id = useId()
  if (meterQuestion) {
    return (
      <div className="mt-1 flex items-center gap-2">
        <Checkbox
          id={id}
          checked={meterReplaced}
          onCheckedChange={(checked) => onMeterReplaced(checked === true)}
        />
        <Label htmlFor={id} className="text-sm font-normal">
          Hidrômetro trocado
        </Label>
      </div>
    )
  }
  if (corrects && before) {
    return (
      <p className="mt-1 text-sm font-semibold text-primary">
        Corrige também a leitura de {formatDateRange(before)} (era{' '}
        {formatNumber(before.currentReading)}).
      </p>
    )
  }
  return null
}

function StatusSelect({
  value,
  onChange,
  canPay,
  ...props
}: {
  value: ReadingDraft['status']
  onChange: (value: ReadingDraft['status']) => void
  /** Without the period's electricity bill there is nothing to pay yet. */
  canPay: boolean
} & Omit<React.ComponentProps<'select'>, 'value' | 'onChange' | 'size'>) {
  return (
    <NativeSelect
      {...props}
      value={canPay ? value : 'pendente'}
      disabled={!canPay || props.disabled}
      title={
        canPay
          ? undefined
          : 'A conta de energia do período ainda não foi informada.'
      }
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
 * One row of the chácara's spreadsheet in edit mode. The dates, "Última
 * leitura" and "Leitura atual" can change; the value comes from splitting
 * the period's electricity bill, so it is recalculated when saving.
 */
export function ReadingEditorRow({
  initial,
  label,
  before,
  linked,
  canPay,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: ReadingDraft
  /** Describes the row for screen readers, e.g. "10/09/2026 a 10/10/2026". */
  label: string
  before: Before | null
  linked: boolean
  canPay: boolean
  pending: boolean
  onSubmit: (values: ReadingValues) => Promise<boolean>
  onCancel: () => void
}) {
  const {
    draft,
    set,
    digits,
    consumption,
    invalidField,
    validate,
    corrects,
    meterQuestion,
  } = useReadingDraft(initial, before, linked)

  async function submit() {
    const values = validate()
    if (values) await onSubmit(values)
  }

  return (
    <TableRow
      className="bg-secondary/60 align-top hover:bg-secondary/60"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault()
          void submit()
        }
        if (event.key === 'Escape') onCancel()
      }}
    >
      <TableCell>
        <div className="flex flex-col gap-1">
          <DateInput
            aria-label={`Data da última leitura (${label})`}
            aria-invalid={invalidField === 'start'}
            className="w-[8.5rem]"
            value={draft.start}
            onChange={(value) => set('start', value)}
          />
          <DateInput
            aria-label={`Data da leitura (${label})`}
            aria-invalid={invalidField === 'end'}
            className="w-[8.5rem]"
            value={draft.end}
            onChange={(value) => set('end', value)}
          />
        </div>
      </TableCell>
      <TableCell>
        <Input
          {...digits('previous')}
          aria-label={`Última leitura (${label})`}
          maxLength={9}
          className="w-[6.5rem] text-right tabular-nums"
        />
        <ChainNote
          before={before}
          corrects={corrects}
          meterQuestion={meterQuestion}
          meterReplaced={draft.meterReplaced}
          onMeterReplaced={(value) => set('meterReplaced', value)}
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
      <TableCell className="text-right tabular-nums">
        {consumption === null ? '—' : formatNumber(consumption)}
      </TableCell>
      <TableCell
        colSpan={3}
        className="text-center whitespace-normal text-muted-foreground"
      >
        Recalculado ao salvar, pela divisão da conta do período.
      </TableCell>
      <TableCell>
        <StatusSelect
          aria-label={`Situação (${label})`}
          canPay={canPay}
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

/** A period this chácara has no reading in yet. */
export type OpenPeriod = DateRange & {
  id: number
  energyBillCents: number | null
  /** The chácara's reading before the period, if any. */
  before: Before | null
}

/** What the form starts with for a period: dates and última leitura. */
function draftFor(period: OpenPeriod): ReadingDraft {
  return toDraft({
    startDate: period.before?.endDate ?? period.startDate,
    endDate: period.endDate,
    previousReading: period.before?.currentReading ?? null,
    currentReading: null,
    paid: false,
  })
}

/**
 * "Nova leitura" below the spreadsheet: a period without a reading of this
 * chácara, with "Última leitura" from the reading before it.
 */
export function NewReadingForm({
  periods,
  initialPeriodId,
  pending,
  onSubmit,
}: {
  periods: OpenPeriod[]
  initialPeriodId: number
  pending: boolean
  onSubmit: (periodId: number, values: ReadingValues) => Promise<boolean>
}) {
  const [periodId, setPeriodId] = useState(initialPeriodId)
  const period = periods.find((option) => option.id === periodId) ?? periods[0]
  const before = period?.before ?? null
  const {
    draft,
    set,
    setDraft,
    digits,
    consumption,
    invalidField,
    validate,
    corrects,
    meterQuestion,
  } = useReadingDraft(
    period
      ? draftFor(period)
      : toDraft({
          startDate: '',
          endDate: '',
          previousReading: null,
          currentReading: null,
          paid: false,
        }),
    before,
    true,
  )

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!period) return
    const values = validate()
    if (values) await onSubmit(period.id, values)
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle className="text-xl">Nova leitura</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
            <FormField
              label="Período"
              className="col-span-2 sm:col-span-3 lg:col-span-2"
            >
              {(props) => (
                <NativeSelect
                  {...props}
                  className="tabular-nums"
                  value={period?.id ?? ''}
                  onChange={(event) => {
                    const next = periods.find(
                      (option) => option.id === Number(event.target.value),
                    )
                    if (!next) return
                    setPeriodId(next.id)
                    setDraft(draftFor(next))
                  }}
                >
                  {periods.map((option) => (
                    <NativeSelectOption key={option.id} value={option.id}>
                      {formatDateRange(option)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label="Última leitura em">
              {(props) => (
                <DateInput
                  {...props}
                  aria-invalid={invalidField === 'start'}
                  value={draft.start}
                  onChange={(value) => set('start', value)}
                />
              )}
            </FormField>
            <FormField label="Leitura atual em">
              {(props) => (
                <DateInput
                  {...props}
                  aria-invalid={invalidField === 'end'}
                  value={draft.end}
                  onChange={(value) => set('end', value)}
                />
              )}
            </FormField>
            <FormField label="Última leitura">
              {(props) => (
                <div>
                  <Input
                    {...props}
                    {...digits('previous')}
                    maxLength={9}
                    className="text-right tabular-nums"
                  />
                  <ChainNote
                    before={before}
                    corrects={corrects}
                    meterQuestion={meterQuestion}
                    meterReplaced={draft.meterReplaced}
                    onMeterReplaced={(value) => set('meterReplaced', value)}
                  />
                </div>
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
            <FormField label="Situação">
              {(props) => (
                <StatusSelect
                  {...props}
                  canPay={period?.energyBillCents != null}
                  value={draft.status}
                  onChange={(value) => set('status', value)}
                />
              )}
            </FormField>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground tabular-nums" aria-live="polite">
            {consumption !== null ? (
              <>
                <strong className="text-lg text-foreground">
                  {formatNumber(consumption)} m³
                </strong>{' '}
                de água. O valor sai da divisão da conta de energia do período e
                é calculado ao salvar.
              </>
            ) : (
              'Digite a leitura atual para ver o consumo.'
            )}
          </p>
          <Button type="submit" size="lg" disabled={pending || !period}>
            <Check aria-hidden="true" />
            {pending ? 'Salvando…' : 'Adicionar leitura'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
