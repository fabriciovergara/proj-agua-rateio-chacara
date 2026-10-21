import { cn } from 'cn'
import { Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription } from '#/components/ui/alert'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#/components/ui/empty'

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[2rem] font-bold tracking-[-0.01em]">{title}</h1>
        {description && (
          <p className="mt-2 max-w-[62ch] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          {actions}
        </div>
      )}
    </div>
  )
}

/** A section heading inside a page. */
export function SectionTitle({
  children,
  description,
  className,
}: {
  children: ReactNode
  description?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-4', className)}>
      <h2 className="text-[1.35rem] font-bold">{children}</h2>
      {description && (
        <p className="mt-1 max-w-[62ch] text-muted-foreground">{description}</p>
      )}
    </div>
  )
}

/** Shown when a list has nothing yet: says what to do next. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <Empty className="border bg-card">
      <EmptyHeader>
        <EmptyTitle className="text-[1.2rem] font-bold">{title}</EmptyTitle>
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

/** A short notice above content (missing settings, outdated prices…). */
export function Notice({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warning'
  children: ReactNode
  action?: ReactNode
}) {
  const Icon = tone === 'warning' ? TriangleAlert : Info
  return (
    <Alert
      role="status"
      className={cn(
        'items-center',
        tone === 'warning'
          ? 'border-pending/40 bg-pending-soft text-foreground'
          : 'border-primary/30 bg-secondary text-foreground',
      )}
    >
      <Icon aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-base text-foreground">
        <div className="max-w-[70ch]">{children}</div>
        {action}
      </AlertDescription>
    </Alert>
  )
}
