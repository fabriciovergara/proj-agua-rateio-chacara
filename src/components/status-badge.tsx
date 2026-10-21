import { CircleCheck, Clock3 } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { formatDate } from '#/lib/periods'

/** Paid or pending, always with an icon and a word (never colour alone). */
export function StatusBadge({
  paid,
  paidAt,
  className,
}: {
  paid: boolean
  paidAt?: string | null
  className?: string
}) {
  return (
    <Badge
      variant={paid ? 'paid' : 'pending'}
      className={`px-2.5 text-sm font-semibold [&>svg]:size-4 ${className ?? ''}`}
    >
      {paid ? (
        <CircleCheck aria-hidden="true" />
      ) : (
        <Clock3 aria-hidden="true" />
      )}
      {paid ? 'Pago' : 'Pendente'}
      {paid && paidAt && (
        <span className="font-normal">em {formatDate(paidAt)}</span>
      )}
    </Badge>
  )
}
