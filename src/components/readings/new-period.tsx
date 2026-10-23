import { useNavigate } from '@tanstack/react-router'
import { Check, Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'
import { DateInput, FormField } from '#/components/form'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { FieldGroup } from '#/components/ui/field'
import { type DateRange, formatDate, parseDate } from '#/lib/periods'
import { useAction } from '#/lib/use-action'
import { createPeriod } from '#/server/readings.functions'

const HINT =
  'As datas valem para todas as chácaras. Depois, dá para mudar as de uma chácara lida em outro dia.'

/** The dates of a new period, prefilled to follow the newest one. */
function useNewPeriod(defaults: DateRange, onCreated?: () => void) {
  const navigate = useNavigate()
  const [start, setStart] = useState(formatDate(defaults.startDate))
  const [end, setEnd] = useState(formatDate(defaults.endDate))
  const create = useAction(createPeriod, { success: 'Período criado.' })
  const startDate = parseDate(start)
  const endDate = parseDate(end)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!startDate || !endDate) {
      toast.error('Informe as duas datas, como 10/09/2026.')
      return
    }
    if (startDate >= endDate) {
      toast.error('A data final precisa ser depois da inicial.')
      return
    }
    const created = await create.run({ data: { startDate, endDate } })
    if (!created) return
    onCreated?.()
    await navigate({ to: '/', search: { periodo: created.id } })
  }

  const fields = (
    <FieldGroup className="grid gap-5 sm:grid-cols-2">
      <FormField
        label="De"
        description="Dia da leitura anterior."
        error={
          start !== '' && !startDate ? 'Use o formato 10/09/2026.' : undefined
        }
      >
        {(props) => (
          <DateInput
            {...props}
            className="h-11 text-lg md:text-lg"
            value={start}
            onChange={setStart}
          />
        )}
      </FormField>
      <FormField
        label="Até"
        description="Dia em que os hidrômetros são lidos."
        error={
          end !== '' && !endDate
            ? 'Use o formato 10/10/2026.'
            : startDate && endDate && startDate >= endDate
              ? 'Precisa ser depois do início.'
              : undefined
        }
      >
        {(props) => (
          <DateInput
            {...props}
            className="h-11 text-lg md:text-lg"
            value={end}
            onChange={setEnd}
          />
        )}
      </FormField>
    </FieldGroup>
  )

  return { fields, submit, pending: create.pending }
}

/** "Novo período" next to the newest period. */
export function NewPeriodDialog({
  defaults,
  className,
}: {
  defaults: DateRange
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // A fresh form, with the current defaults, every time it opens.
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className={className}>
          <Plus aria-hidden="true" />
          Novo período
        </Button>
      </DialogTrigger>
      <DialogContent>
        {open && (
          <NewPeriodDialogForm
            defaults={defaults}
            onCreated={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function NewPeriodDialogForm({
  defaults,
  onCreated,
}: {
  defaults: DateRange
  onCreated: () => void
}) {
  const { fields, submit, pending } = useNewPeriod(defaults, onCreated)
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <DialogHeader>
        <DialogTitle className="text-xl">Novo período de leitura</DialogTitle>
        <DialogDescription className="text-base">{HINT}</DialogDescription>
      </DialogHeader>
      {fields}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancelar</Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          <Check aria-hidden="true" />
          {pending ? 'Criando…' : 'Criar período'}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** The first period, when there is none yet. */
export function FirstPeriodForm({ defaults }: { defaults: DateRange }) {
  const { fields, submit, pending } = useNewPeriod(defaults)
  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle className="text-xl">Primeiro período de leitura</CardTitle>
          <CardDescription className="text-base">
            Escolha de que dia a que dia vão as leituras dos hidrômetros. {HINT}
          </CardDescription>
        </CardHeader>
        <CardContent>{fields}</CardContent>
        <CardFooter>
          <Button type="submit" size="lg" disabled={pending}>
            <Check aria-hidden="true" />
            {pending ? 'Criando…' : 'Criar período'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
