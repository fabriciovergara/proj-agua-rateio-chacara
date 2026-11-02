import { createFileRoute, Link } from '@tanstack/react-router'
import {
  CircleAlert,
  CircleCheck,
  Pencil,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { Notice, PageHeader } from '#/components/page'
import {
  NewTankReadingForm,
  TankEditorRow,
} from '#/components/tank/tank-reading-form'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { formatNumber } from '#/lib/money'
import { formatDate, formatDateRangeShort } from '#/lib/periods'
import {
  formatTankReading,
  type TankEntry,
  type TankPoint,
  TOLERANCE,
  TOLERANCE_M3,
  type Verdict,
} from '#/lib/tank'
import { useAction } from '#/lib/use-action'
import {
  deleteTankReading,
  getTankPage,
  saveTankReading,
} from '#/server/tank.functions'

export const Route = createFileRoute('/caixa-dagua')({
  loader: () => getTankPage(),
  head: () => ({ meta: [{ title: 'Caixa d’água — Rateio da Água' }] }),
  component: TankPage,
})

type Page = Awaited<ReturnType<typeof getTankPage>>
type Row = Page['rows'][number]
type Since = NonNullable<Row['since']>
type Result = NonNullable<Since['result']>

const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 0,
})
/** "82 m³", never split between two lines. */
const m3 = (value: number) => `${formatNumber(value)}\u00a0m³`
/** +28 / −12: positive is the tank measuring more. */
const signed = (value: number) =>
  value > 0
    ? `+${formatNumber(value)}`
    : value < 0
      ? `−${formatNumber(-value)}`
      : '0'
const shareOf = (result: Result) =>
  result.share === null ? '' : ` (${percent.format(Math.abs(result.share))})`
const rangeOf = (row: Row & { since: Since }) =>
  formatDateRangeShort({ startDate: row.since.startDate, endDate: row.date })

/**
 * "falta a leitura da Chácara 3", "faltam as leituras da Chácara 3 e da
 * Chácara 5", or how many.
 */
function missingText(names: string[]) {
  if (names.length === 1) return `falta a leitura de ${names[0]}`
  const who =
    names.length > 3
      ? `${names.length} chácaras`
      : `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`
  return `faltam as leituras de ${who}`
}

const capitalized = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1)

const VERDICTS = {
  normal: { label: 'Normal', variant: 'paid', Icon: CircleCheck },
  vazamento: {
    label: 'Possível vazamento',
    variant: 'pending',
    Icon: TriangleAlert,
  },
  conferir: {
    label: 'Conferir leituras',
    variant: 'pending',
    Icon: CircleAlert,
  },
} as const

/** The comparison's result, always with an icon and words. */
function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { label, variant, Icon } = VERDICTS[verdict]
  return (
    <Badge
      variant={variant}
      className="px-2.5 text-sm font-semibold whitespace-normal [&>svg]:size-4"
    >
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}

function TankPage() {
  const page = Route.useLoaderData()
  const save = useAction(saveTankReading, {
    success: 'Leitura da caixa d’água salva.',
  })
  /** Oldest first, to check a reading typed among them. */
  const points: TankPoint[] = page.rows
    .map(({ id, date, liters, meterReplaced }) => ({
      id,
      date,
      liters,
      meterReplaced,
    }))
    .reverse()

  async function handleSave(entry: TankEntry) {
    return Boolean(await save.run({ data: entry }))
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Caixa d’água"
        description="O hidrômetro da caixa d’água mede toda a água que vai para as chácaras. Comparando com o que os hidrômetros delas marcaram nos mesmos dias, dá para perceber água se perdendo no caminho."
        className="mb-0"
      />
      <LeakNotices rows={page.rows} />
      <NewTankReadingForm
        points={points}
        today={page.today}
        pace={page.pace}
        pending={save.pending}
        onSubmit={handleSave}
      />
      {page.averages && (
        <Averages averages={page.averages} last={page.rows[0]} />
      )}
      <ReadingsTable
        page={page}
        points={points}
        pending={save.pending}
        onSave={handleSave}
      />
    </div>
  )
}

/** The newest comparison, in words, and what the newest reading waits for. */
function LeakNotices({ rows }: { rows: Row[] }) {
  const newest = rows[0]
  const waiting =
    newest?.since && newest.since.missing.length > 0 ? newest.since : null
  const latest = rows.find(
    (row): row is Row & { since: Since & { result: Result } } =>
      row.since?.result != null,
  )
  if (!waiting && !latest) return null

  return (
    <div className="flex flex-col gap-3">
      {waiting && newest && (
        <Notice
          action={
            <Button asChild variant="outline" className="bg-card">
              <Link to="/">Ir para Leituras</Link>
            </Button>
          }
        >
          Para comparar a leitura de {formatDate(newest.date)},{' '}
          {missingText(waiting.missing)} até esse dia.
        </Notice>
      )}
      {latest && <VerdictNotice row={latest} />}
    </div>
  )
}

function VerdictNotice({
  row,
}: {
  row: Row & { since: Since & { result: Result } }
}) {
  const { since } = row
  const { result } = since
  const tank = m3(since.consumption ?? 0)
  const chacaras = m3(since.chacaras?.consumption ?? 0)
  const difference = m3(Math.abs(result.difference))
  const range = rangeOf(row)
  if (result.verdict === 'normal') {
    return (
      <Notice>
        <strong>Sem sinal de vazamento.</strong> De {range}, a caixa d’água
        mediu {tank} e as chácaras {chacaras}: diferença de {difference}
        {shareOf(result)}, dentro do normal.
      </Notice>
    )
  }
  if (result.verdict === 'vazamento') {
    return (
      <Notice tone="warning">
        <strong>Possível vazamento.</strong> De {range}, a caixa d’água mediu{' '}
        {tank} e as chácaras {chacaras}: {difference}
        {shareOf(result)} a mais na caixa. Confira canos, registros e boias
        entre a caixa e os hidrômetros das chácaras.
      </Notice>
    )
  }
  return (
    <Notice tone="warning">
      <strong>Confira as leituras.</strong> De {range}, as chácaras mediram{' '}
      {chacaras} e a caixa d’água {tank}: {difference}
      {shareOf(result)} a mais nas chácaras. Costuma ser um número digitado
      errado, na caixa ou numa chácara.
    </Notice>
  )
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'warning'
}) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={`text-[1.3rem] font-bold ${tone === 'warning' ? 'text-pending' : ''}`}
      >
        {value}
      </dd>
      {hint && <dd className="text-sm text-muted-foreground">{hint}</dd>}
    </div>
  )
}

/** The averages a month: the tank's and, in the same days, the chácaras'. */
function Averages({
  averages,
  last,
}: {
  averages: NonNullable<Page['averages']>
  last: Row | undefined
}) {
  const { result } = averages
  const when = averages.fullYear
    ? `nos 12 meses até ${formatDate(averages.endDate)}`
    : `de ${formatDate(averages.startDate)} a ${formatDate(averages.endDate)}`
  return (
    <section aria-labelledby="titulo-medias">
      <h2 id="titulo-medias" className="sr-only">
        Médias por mês
      </h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y py-5 tabular-nums lg:grid-cols-4">
        <Stat
          label="Caixa d’água por mês"
          value={m3(averages.tankPerMonth)}
          hint={`Média ${when}`}
        />
        <Stat
          label="Chácaras por mês"
          value={
            averages.chacarasPerMonth === null
              ? '—'
              : m3(averages.chacarasPerMonth)
          }
          hint={
            averages.chacarasPerMonth !== null
              ? 'Nos mesmos dias'
              : averages.missing.length > 0
                ? capitalized(missingText(averages.missing))
                : 'Sem leituras das chácaras nesses dias'
          }
        />
        <Stat
          label="Diferença por mês"
          value={
            result
              ? `${signed(result.difference)}\u00a0m³${shareOf(result)}`
              : '—'
          }
          hint={
            result
              ? result.verdict === 'vazamento'
                ? 'Possível vazamento'
                : result.verdict === 'conferir'
                  ? 'As chácaras mediram mais'
                  : 'Dentro do normal'
              : undefined
          }
          tone={result && result.verdict !== 'normal' ? 'warning' : undefined}
        />
        {last && (
          <Stat
            label="Última leitura"
            value={`${formatTankReading(last.liters)}\u00a0m³`}
            hint={`Em ${formatDate(last.date)}`}
          />
        )}
      </dl>
    </section>
  )
}

/** Situação of a row that has no comparison: what it waits for. */
function pendingText(since: Since | null) {
  if (!since) return 'Primeira leitura'
  if (since.consumption === null) return 'Hidrômetro trocado'
  if (since.missing.length > 0) return capitalized(missingText(since.missing))
  if (since.uncovered) return 'Sem leituras das chácaras nesses dias'
  return '—'
}

function ReadingsTable({
  page,
  points,
  pending,
  onSave,
}: {
  page: Page
  points: TankPoint[]
  pending: boolean
  onSave: (entry: TankEntry) => Promise<boolean>
}) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const remove = useAction(deleteTankReading, {
    success: 'Leitura apagada.',
  })
  const { rows } = page
  const estimated = rows.some((row) => row.since?.chacaras?.estimated)

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="gap-1 border-b py-5">
        <CardTitle className="text-xl">Leituras da caixa d’água</CardTitle>
        <CardDescription className="text-base">
          Em cada linha, a água que passou pela caixa desde a leitura anterior e
          o que os hidrômetros das chácaras marcaram nos mesmos dias. Até{' '}
          {percent.format(TOLERANCE)} (ou {TOLERANCE_M3} m³) de diferença é
          normal: os hidrômetros não são exatos.
        </CardDescription>
      </CardHeader>
      {rows.length === 0 ? (
        <CardContent className="py-6 text-muted-foreground">
          <p>
            Nenhuma leitura ainda. Com duas leituras, aparece quanto a caixa
            d’água gastou por mês e a comparação com as chácaras.
          </p>
          {page.canImport && (
            <p className="mt-2">
              Tem leituras antigas numa planilha? Traga em{' '}
              <Link
                to="/configuracoes"
                className="font-semibold text-primary underline"
              >
                Configurações → Importar dados
              </Link>
              .
            </p>
          )}
        </CardContent>
      ) : (
        <>
          <Table className="text-[0.95rem]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Leitura (m³)</TableHead>
                <TableHead className="text-right">Consumo</TableHead>
                <TableHead className="text-right whitespace-normal">
                  Por mês
                </TableHead>
                <TableHead className="text-right">Chácaras</TableHead>
                <TableHead className="text-right">Diferença</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) =>
                editingId === row.id ? (
                  <TankEditorRow
                    key={row.id}
                    reading={row}
                    points={points}
                    today={page.today}
                    pending={pending}
                    onSubmit={async (entry) => {
                      const saved = await onSave(entry)
                      if (saved) setEditingId(null)
                      return saved
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <ReadingRow
                    key={row.id}
                    row={row}
                    disabled={editingId !== null || remove.pending}
                    onEdit={() => setEditingId(row.id)}
                    onDelete={() => remove.run({ data: { id: row.id } })}
                  />
                ),
              )}
            </TableBody>
          </Table>
          {estimated && (
            <p className="border-t px-5 py-3 text-sm text-muted-foreground">
              * Estimado: as chácaras não foram lidas nos mesmos dias que a
              caixa d’água, então o consumo delas foi dividido pelos dias.
            </p>
          )}
        </>
      )}
    </Card>
  )
}

function ReadingRow({
  row,
  disabled,
  onEdit,
  onDelete,
}: {
  row: Row
  disabled: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { since } = row
  const label = formatDate(row.date)
  return (
    <TableRow>
      <TableCell className="font-semibold tabular-nums">{label}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatTankReading(row.liters)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {since?.consumption != null ? (
          <>
            <span className="font-semibold">{m3(since.consumption)}</span>
            <span className="block text-sm text-muted-foreground">
              em {since.days === 1 ? '1 dia' : `${since.days} dias`}
            </span>
          </>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {since?.perMonth != null ? m3(since.perMonth) : '—'}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {since?.chacaras
          ? `${m3(since.chacaras.consumption)}${since.chacaras.estimated ? '*' : ''}`
          : '—'}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {since?.result ? (
          <>
            <span className="font-semibold">
              {signed(since.result.difference)}&nbsp;m³
            </span>
            {since.result.share !== null && (
              <span className="block text-sm text-muted-foreground">
                {percent.format(Math.abs(since.result.share))}
              </span>
            )}
          </>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell className="whitespace-normal">
        {since?.result ? (
          <VerdictBadge verdict={since.result.verdict} />
        ) : (
          <span className="text-sm text-muted-foreground">
            {pendingText(since)}
          </span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Corrigir a leitura de ${label}`}
            disabled={disabled}
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <ConfirmDialog
            title={`Apagar a leitura de ${label}?`}
            description={
              <p>
                O consumo entre a leitura anterior e a seguinte é calculado de
                novo. Esta ação não pode ser desfeita.
              </p>
            }
            confirmLabel="Apagar leitura"
            onConfirm={onDelete}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Apagar a leitura de ${label}`}
                disabled={disabled}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            }
          />
        </div>
      </TableCell>
    </TableRow>
  )
}
