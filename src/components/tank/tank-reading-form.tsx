import { Check, X } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'
import { DateInput, FormField, MeterInput } from '#/components/form'
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
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { FieldGroup } from '#/components/ui/field'
import { Label } from '#/components/ui/label'
import { TableCell, TableRow } from '#/components/ui/table'
import { formatNumber } from '#/lib/money'
import { daysBetween, formatDate, parseDate } from '#/lib/periods'
import {
  checkTankReading,
  formatTankReading,
  isUnusualPace,
  parseTankReading,
  perMonth,
  type TankEntry,
  type TankPoint,
} from '#/lib/tank'

/** The meter's number as typed: "1254,37" (liters after the comma). */
const tankReadingText = (liters: number) =>
  formatTankReading(liters).replace(/\./g, '')

type Field = 'date' | 'reading'

/**
 * A tank reading being typed (new or a correction): the values, what is
 * wrong with them and the water used since the reading before.
 */
function useTankDraft({
  points,
  today,
  id,
  initial,
}: {
  /** The tank's readings, oldest first. */
  points: TankPoint[]
  today: string
  id?: number
  initial: { date: string; reading: string; meterReplaced?: boolean }
}) {
  const [date, setDate] = useState(initial.date)
  const [reading, setReading] = useState(initial.reading)
  const [meterReplaced, setMeterReplaced] = useState(
    initial.meterReplaced ?? false,
  )
  const [invalid, setInvalid] = useState<Field | null>(null)

  const dateISO = parseDate(date)
  const liters = reading === '' ? null : parseTankReading(reading)
  const check =
    dateISO && liters !== null
      ? checkTankReading(
          points,
          { id, date: dateISO, liters, meterReplaced },
          today,
        )
      : null
  const before = check
    ? check.before
    : points.filter((point) => point.id !== id).at(-1)
  /** Since the reading before, unless the meter was replaced. */
  const since =
    check?.before && dateISO && liters !== null && !check.meterQuestion
      ? {
          consumption: (liters - check.before.liters) / 1000,
          days: daysBetween(check.before.date, dateISO),
        }
      : null

  function change(field: Field, update: () => void) {
    update()
    if (invalid === field) setInvalid(null)
  }

  /** The values to save, or null after showing what is wrong. */
  function validate(): TankEntry | null {
    const fail = (field: Field, message: string) => {
      setInvalid(field)
      toast.error(message)
      return null
    }
    if (!dateISO) {
      return fail('date', 'Informe a data da leitura, como 10/10/2026.')
    }
    if (liters === null) {
      return fail(
        'reading',
        reading === ''
          ? 'Informe a leitura do hidrômetro da caixa d’água.'
          : 'Confira a leitura: até 3 números depois da vírgula, como 1254,37.',
      )
    }
    if (check?.problem) {
      return fail(
        check.issue === 'future' || check.issue === 'same-date'
          ? 'date'
          : 'reading',
        check.problem,
      )
    }
    return {
      id,
      date: dateISO,
      liters,
      meterReplaced: check?.meterQuestion ? meterReplaced : undefined,
    }
  }

  return {
    date,
    setDate: (value: string) => change('date', () => setDate(value)),
    reading,
    setReading: (value: string) => change('reading', () => setReading(value)),
    meterReplaced,
    setMeterReplaced,
    invalid,
    check,
    before,
    since,
    validate,
    reset() {
      setDate(initial.date)
      setReading(initial.reading)
      setMeterReplaced(false)
      setInvalid(null)
    },
  }
}

type Draft = ReturnType<typeof useTankDraft>

/** Under the reading: the meter question, or what is wrong with the date. */
function DraftNote({ draft }: { draft: Draft }) {
  const id = useId()
  const { check } = draft
  if (check?.meterQuestion) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={draft.meterReplaced}
            onCheckedChange={(checked) =>
              draft.setMeterReplaced(checked === true)
            }
          />
          <Label htmlFor={id} className="text-sm leading-snug">
            Hidrômetro trocado
          </Label>
        </div>
        {!draft.meterReplaced && check.before && (
          <p className="text-sm font-semibold text-destructive">
            Menor que a leitura de {formatDate(check.before.date)} (
            {formatTankReading(check.before.liters)}).
          </p>
        )}
      </div>
    )
  }
  if (check?.issue === 'higher' || check?.issue === 'future') {
    return (
      <p className="text-sm font-semibold text-destructive">{check.problem}</p>
    )
  }
  return null
}

/** "540 m³ em 30 dias, cerca de 548 m³ por mês". */
function sinceText(since: NonNullable<Draft['since']>) {
  const monthly = perMonth(since.consumption, since.days)
  const days = since.days === 1 ? '1 dia' : `${since.days} dias`
  const pace =
    monthly === null
      ? ''
      : `, cerca de ${formatNumber(monthly)}\u00a0m³ por mês`
  return `${formatNumber(since.consumption)}\u00a0m³ em ${days}${pace}`
}

/**
 * "Nova leitura" of the caixa d'água: the day and the number on its meter.
 * A number far above the usual pace asks before saving.
 */
export function NewTankReadingForm({
  points,
  today,
  pace,
  pending,
  onSubmit,
}: {
  points: TankPoint[]
  today: string
  /** m³ a month lately. */
  pace: number | null
  pending: boolean
  onSubmit: (entry: TankEntry) => Promise<boolean>
}) {
  const draft = useTankDraft({
    points,
    today,
    initial: { date: formatDate(today), reading: '' },
  })
  const [confirming, setConfirming] = useState(false)
  const unusual =
    draft.since !== null &&
    isUnusualPace(draft.since.consumption, draft.since.days, pace)

  async function save() {
    setConfirming(false)
    const entry = draft.validate()
    if (entry && (await onSubmit(entry))) draft.reset()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft.validate()) return
    if (unusual) setConfirming(true)
    else void save()
  }

  const { before } = draft
  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle className="text-xl">Nova leitura</CardTitle>
          <CardDescription className="text-base">
            O número do hidrômetro da caixa d’água, em m³. Os números vermelhos
            (os litros) podem ir depois da vírgula, como 1254,37.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-5 sm:grid-cols-[minmax(0,12rem)_minmax(0,16rem)_1fr] sm:items-start">
            <FormField label="Data da leitura">
              {(props) => (
                <DateInput
                  {...props}
                  aria-invalid={draft.invalid === 'date'}
                  className="h-13 text-lg md:text-lg"
                  value={draft.date}
                  onChange={draft.setDate}
                />
              )}
            </FormField>
            <FormField label="Leitura (m³)">
              {(props) => (
                <div className="flex flex-col gap-2">
                  <MeterInput
                    {...props}
                    decimals={3}
                    aria-invalid={draft.invalid === 'reading'}
                    value={draft.reading}
                    onChange={draft.setReading}
                  />
                  <DraftNote draft={draft} />
                </div>
              )}
            </FormField>
            <div
              className="flex flex-col gap-1 tabular-nums sm:pt-8"
              aria-live="polite"
            >
              {before ? (
                <p className="text-muted-foreground">
                  Leitura anterior:{' '}
                  <strong className="text-foreground">
                    {formatTankReading(before.liters)} m³
                  </strong>{' '}
                  em {formatDate(before.date)}.
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Primeira leitura: o consumo aparece a partir da próxima.
                </p>
              )}
              {draft.since && (
                <p className="text-lg">
                  Desde então: <strong>{sinceText(draft.since)}</strong>.
                </p>
              )}
              {unusual && (
                <p className="font-semibold text-pending">
                  Muito acima do normal (cerca de {formatNumber(pace ?? 0)} m³
                  por mês). Confira o número; se estiver certo, pode ser um
                  vazamento.
                </p>
              )}
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button type="submit" size="lg" disabled={pending}>
            <Check aria-hidden="true" />
            {pending ? 'Salvando…' : 'Salvar leitura'}
          </Button>
        </CardFooter>
      </form>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">
              Confira antes de salvar
            </AlertDialogTitle>
            <AlertDialogDescription asChild className="space-y-3 text-base">
              <div>
                {draft.since && (
                  <p>
                    Com esta leitura, a caixa d’água teria usado{' '}
                    <strong className="text-foreground">
                      {sinceText(draft.since)}
                    </strong>
                    . O normal é cerca de {formatNumber(pace ?? 0)} m³ por mês.
                  </p>
                )}
                <p>
                  Um número a mais muda muito a conta. Se a leitura estiver
                  certa, pode haver um vazamento.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e conferir</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save()}>
              Salvar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

/**
 * A row of the tank's readings in edit mode: its date and number. What it
 * used and the comparison are recalculated when saving.
 */
export function TankEditorRow({
  reading,
  points,
  today,
  pending,
  onSubmit,
  onCancel,
}: {
  reading: TankPoint
  points: TankPoint[]
  today: string
  pending: boolean
  onSubmit: (entry: TankEntry) => Promise<boolean>
  onCancel: () => void
}) {
  const draft = useTankDraft({
    points,
    today,
    id: reading.id,
    initial: {
      date: formatDate(reading.date),
      reading: tankReadingText(reading.liters),
      meterReplaced: reading.meterReplaced,
    },
  })
  const label = formatDate(reading.date)

  async function submit() {
    const entry = draft.validate()
    if (entry) await onSubmit(entry)
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
        <DateInput
          aria-label={`Data da leitura (${label})`}
          aria-invalid={draft.invalid === 'date'}
          className="w-[8.5rem]"
          value={draft.date}
          onChange={draft.setDate}
        />
      </TableCell>
      <TableCell>
        <div className="flex w-[10rem] flex-col gap-2">
          <MeterInput
            aria-label={`Leitura (${label})`}
            look="plain"
            decimals={3}
            className="text-right tabular-nums"
            aria-invalid={draft.invalid === 'reading'}
            value={draft.reading}
            onChange={draft.setReading}
          />
          <DraftNote draft={draft} />
        </div>
      </TableCell>
      <TableCell
        colSpan={5}
        className="text-center whitespace-normal text-muted-foreground"
      >
        {draft.since
          ? `${sinceText(draft.since)}. A comparação é refeita ao salvar.`
          : 'O consumo e a comparação são refeitos ao salvar.'}
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
