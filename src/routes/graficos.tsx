import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts'
import { z } from 'zod'
import {
  ChartCard,
  STATUS_COLORS,
  seriesColor,
} from '#/components/charts/chart-card'
import { FilterSelect } from '#/components/filter-select'
import { EmptyState, PageHeader } from '#/components/page'
import { Button } from '#/components/ui/button'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '#/components/ui/chart'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { formatBRL, formatKwhPrice, formatNumber } from '#/lib/money'
import { formatPeriod, MONTH_SHORT } from '#/lib/periods'
import { getChartData, getReportOptions } from '#/server/reports.functions'

export const Route = createFileRoute('/graficos')({
  validateSearch: z.object({
    ano: z.number().int().min(2000).max(2100).optional().catch(undefined),
    chacara: z.number().int().positive().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [options, data] = await Promise.all([
      getReportOptions(),
      getChartData({ data: { year: deps.ano, propertyId: deps.chacara } }),
    ])
    return { options, data }
  },
  head: () => ({ meta: [{ title: 'Gráficos — Rateio da Água' }] }),
  component: ChartsPage,
})

type ChartData = Awaited<ReturnType<typeof getChartData>>

const compactBRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const moneyTick = (cents: number) => compactBRL.format(cents / 100)
const axisTick = { fontSize: 14 }

/** "jan/26" on January and on the first month, just "fev" otherwise. */
function monthTicks(data: ChartData) {
  return data.monthly.map((month, index) => ({
    ...month,
    tick:
      index === 0 || month.month === 1
        ? `${MONTH_SHORT[month.month - 1]}/${String(month.year).slice(2)}`
        : MONTH_SHORT[month.month - 1],
    title: formatPeriod(month),
  }))
}

/** shadcn tooltip rows with Brazilian formatting instead of toLocaleString. */
function tooltipFormatter(format: (value: number) => string) {
  return (value: unknown, name: unknown, item: { color?: string }) => (
    <div className="flex w-full items-center gap-2">
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-[2px]"
        style={{ background: item.color }}
      />
      <span className="text-muted-foreground">{String(name)}</span>
      <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">
        {format(Number(value))}
      </span>
    </div>
  )
}

const titleFromPayload = (
  _: ReactNode,
  payload: ReadonlyArray<{ payload?: { title?: string } }>,
) => payload[0]?.payload?.title ?? ''

function ChartsPage() {
  const { options, data } = Route.useLoaderData()
  const { ano, chacara } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { totals } = data

  const averagePriceMicros =
    totals.consumption > 0
      ? Math.round((totals.energyCents * 10_000) / totals.consumption / 100) *
        100
      : null
  const rangeLabel = ano ? `em ${ano}` : 'nos últimos 12 meses'

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Gráficos"
        description="Quanto a bomba gastou de energia, quem consumiu mais e como estão os pagamentos."
        className="mb-0"
      />

      <div className="flex flex-wrap items-end gap-4">
        <FilterSelect
          label="Período"
          value={ano ?? ''}
          onChange={(value) =>
            navigate({
              search: { chacara, ano: value ? Number(value) : undefined },
            })
          }
          options={[
            { value: '', label: 'Últimos 12 meses' },
            ...options.years.map((year) => ({ value: year, label: year })),
          ]}
        />
        <FilterSelect
          label="Chácara"
          value={chacara ?? ''}
          onChange={(value) =>
            navigate({
              search: { ano, chacara: value ? Number(value) : undefined },
            })
          }
          className="min-w-[16rem]"
          options={[
            { value: '', label: 'Todas as chácaras' },
            ...options.properties.map((property) => ({
              value: property.id,
              label: property.name,
            })),
          ]}
        />
      </div>

      {data.readingsCount === 0 ? (
        <EmptyState
          title={`Nenhuma leitura ${rangeLabel}`}
          action={
            <Button asChild>
              <Link to="/">Lançar leituras</Link>
            </Button>
          }
        >
          Os gráficos aparecem assim que houver leituras no período escolhido.
        </EmptyState>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y py-5 tabular-nums md:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="Custo da energia"
              value={formatBRL(totals.energyCents)}
            />
            <Stat
              label="Consumo"
              value={`${formatNumber(totals.consumption)} kWh`}
            />
            <Stat
              label="Preço médio do kWh"
              value={
                averagePriceMicros === null
                  ? '—'
                  : formatKwhPrice(averagePriceMicros)
              }
            />
            <Stat
              label="Recebido"
              value={formatBRL(totals.paidCents)}
              tone="paid"
            />
            <Stat label="A receber" value={formatBRL(totals.pendingCents)} />
            <Stat
              label="Fundo de reserva recebido"
              value={formatBRL(totals.reserveFundPaidCents)}
            />
          </dl>

          <EnergyByMonth data={data} rangeLabel={rangeLabel} />
          <div className="grid gap-8 xl:grid-cols-2">
            <ConsumptionByProperty data={data} rangeLabel={rangeLabel} />
            <PaymentsByMonth data={data} />
          </div>
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'paid'
}) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={`text-[1.3rem] font-bold ${tone === 'paid' ? 'text-paid' : ''}`}
      >
        {value}
      </dd>
    </div>
  )
}

function EnergyByMonth({
  data,
  rangeLabel,
}: {
  data: ChartData
  rangeLabel: string
}) {
  const rows = monthTicks(data).map((month) => ({
    ...month,
    ...Object.fromEntries(
      data.series.map((s) => [`s${s.id}`, month.energyBySeries[s.id] ?? 0]),
    ),
  }))
  const config = Object.fromEntries(
    data.series.map((s) => [
      `s${s.id}`,
      { label: s.name, color: seriesColor(s.slot) },
    ]),
  ) satisfies ChartConfig
  const last = data.series.length - 1

  return (
    <ChartCard
      title="Custo da energia por mês"
      description={`Consumo × preço do kWh de cada chácara ${rangeLabel}, sem o fundo de reserva.`}
      height={380}
      table={
        <Table className="text-[0.95rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead>
              {data.series.map((s) => (
                <TableHead key={s.id} className="text-right">
                  {s.name}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((month) => (
              <TableRow key={month.key}>
                <TableCell>{month.title}</TableCell>
                {data.series.map((s) => (
                  <TableCell key={s.id} className="text-right tabular-nums">
                    {formatBRL(month.energyBySeries[s.id] ?? 0)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-bold tabular-nums">
                  {formatBRL(month.energyCents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    >
      <ChartContainer config={config} className="aspect-auto h-[380px] w-full">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="tick"
            tickLine={false}
            axisLine={false}
            tick={axisTick}
            interval={0}
          />
          <YAxis
            tickFormatter={moneyTick}
            tickLine={false}
            axisLine={false}
            tick={axisTick}
            width={72}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="min-w-[14rem] text-sm"
                labelFormatter={titleFromPayload}
                formatter={tooltipFormatter(formatBRL)}
              />
            }
          />
          {data.series.length > 1 && (
            <ChartLegend
              verticalAlign="top"
              // Same order as the stack and the colour slots, not alphabetical.
              itemSorter={(item) =>
                data.series.findIndex((s) => `s${s.id}` === item.dataKey)
              }
              content={<ChartLegendContent className="flex-wrap text-sm" />}
            />
          )}
          {data.series.map((s, index) => (
            <Bar
              key={s.id}
              dataKey={`s${s.id}`}
              name={s.name}
              stackId="energia"
              fill={`var(--color-s${s.id})`}
              stroke="var(--card)"
              strokeWidth={2}
              maxBarSize={24}
              isAnimationActive={false}
              radius={index === last ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </ChartCard>
  )
}

function ConsumptionByProperty({
  data,
  rangeLabel,
}: {
  data: ChartData
  rangeLabel: string
}) {
  const rows = data.byProperty
  const height = Math.max(160, rows.length * 44 + 40)
  const config = {
    consumption: { label: 'Consumo', color: seriesColor(0) },
  } satisfies ChartConfig

  return (
    <ChartCard
      title="Consumo por chácara"
      description={`kWh medidos ${rangeLabel}, do maior para o menor.`}
      height={height}
      table={
        <Table className="text-[0.95rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Chácara</TableHead>
              <TableHead className="text-right">Consumo (kWh)</TableHead>
              <TableHead className="text-right">Custo da energia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(row.consumption)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(row.energyCents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    >
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height }}
      >
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 0, right: 96, bottom: 0, left: 8 }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tick={axisTick}
            tickFormatter={(value: number) => formatNumber(value)}
          />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tick={{ ...axisTick, fill: 'var(--foreground)' }}
            width={170}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="min-w-[12rem] text-sm"
                formatter={tooltipFormatter(
                  (value) => `${formatNumber(value)} kWh`,
                )}
              />
            }
          />
          <Bar
            dataKey="consumption"
            name="Consumo"
            fill="var(--color-consumption)"
            maxBarSize={24}
            isAnimationActive={false}
            radius={[0, 4, 4, 0]}
          >
            <LabelList
              dataKey="consumption"
              position="right"
              formatter={(value) => `${formatNumber(Number(value))} kWh`}
              className="fill-muted-foreground"
              fontSize={14}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartCard>
  )
}

function PaymentsByMonth({ data }: { data: ChartData }) {
  const rows = monthTicks(data)
  const config = {
    paidCents: { label: 'Pago', color: STATUS_COLORS.paid },
    pendingCents: { label: 'Pendente', color: STATUS_COLORS.pending },
  } satisfies ChartConfig

  return (
    <ChartCard
      title="Pagamentos por mês"
      description="Valor total cobrado (energia + fundo), separado entre pago e pendente."
      height={320}
      table={
        <Table className="text-[0.95rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead>
              <TableHead className="text-right">Pago</TableHead>
              <TableHead className="text-right">Pendente</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((month) => (
              <TableRow key={month.key}>
                <TableCell>{month.title}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(month.paidCents)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBRL(month.pendingCents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    >
      <ChartContainer config={config} className="aspect-auto h-[320px] w-full">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="tick"
            tickLine={false}
            axisLine={false}
            tick={axisTick}
            interval={0}
          />
          <YAxis
            tickFormatter={moneyTick}
            tickLine={false}
            axisLine={false}
            tick={axisTick}
            width={72}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="min-w-[14rem] text-sm"
                labelFormatter={titleFromPayload}
                formatter={tooltipFormatter(formatBRL)}
              />
            }
          />
          <ChartLegend
            verticalAlign="top"
            content={<ChartLegendContent className="text-sm" />}
          />
          <Bar
            dataKey="paidCents"
            name="Pago"
            stackId="pagamentos"
            fill="var(--color-paidCents)"
            stroke="var(--card)"
            strokeWidth={2}
            maxBarSize={24}
            isAnimationActive={false}
          />
          <Bar
            dataKey="pendingCents"
            name="Pendente"
            stackId="pagamentos"
            fill="var(--color-pendingCents)"
            stroke="var(--card)"
            strokeWidth={2}
            maxBarSize={24}
            isAnimationActive={false}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
    </ChartCard>
  )
}
