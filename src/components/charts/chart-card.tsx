import { ClientOnly } from '@tanstack/react-router'
import { ChartColumnBig, Table2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

/*
 * Chart colours come from the theme (--chart-1…8, validated for colour-blind
 * separation in that order) and follow the chácara, never its ranking. Light
 * slots fall below 3:1 contrast, so every chart has a legend and a table.
 */
export const seriesColor = (slot: number) => `var(--chart-${(slot % 8) + 1})`

export const STATUS_COLORS = {
  paid: 'var(--paid-mark)',
  pending: 'var(--pending-mark)',
} as const

/** A chart card with a "Ver tabela" switch that shows the same numbers. */
export function ChartCard({
  title,
  description,
  table,
  height,
  children,
}: {
  title: string
  description?: ReactNode
  table: ReactNode
  /** Height of the plot including axis labels and legend. */
  height: number
  children: ReactNode
}) {
  const [showTable, setShowTable] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        {description && (
          <CardDescription className="text-base">{description}</CardDescription>
        )}
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showTable}
            onClick={() => setShowTable((value) => !value)}
          >
            {showTable ? (
              <ChartColumnBig aria-hidden="true" />
            ) : (
              <Table2 aria-hidden="true" />
            )}
            {showTable ? 'Ver gráfico' : 'Ver tabela'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {showTable ? (
          table
        ) : (
          <ClientOnly fallback={<div style={{ height }} />}>
            {children}
          </ClientOnly>
        )}
      </CardContent>
    </Card>
  )
}
