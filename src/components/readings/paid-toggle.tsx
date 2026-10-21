import { Check, Undo2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { useAction } from '#/lib/use-action'
import { setPaid } from '#/server/readings.functions'

/** "Marcar como pago" / "Desfazer" for one reading. */
export function PaidToggle({
  readingId,
  paid,
}: {
  readingId: number
  paid: boolean
}) {
  const toggle = useAction(setPaid, {
    success: (reading) =>
      reading.paid ? 'Pagamento registrado.' : 'Pagamento desfeito.',
  })

  return paid ? (
    <Button
      variant="ghost"
      size="sm"
      disabled={toggle.pending}
      onClick={() => toggle.run({ data: { id: readingId, paid: false } })}
    >
      <Undo2 aria-hidden="true" />
      Desfazer
    </Button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      disabled={toggle.pending}
      onClick={() => toggle.run({ data: { id: readingId, paid: true } })}
    >
      <Check aria-hidden="true" />
      Marcar como pago
    </Button>
  )
}
