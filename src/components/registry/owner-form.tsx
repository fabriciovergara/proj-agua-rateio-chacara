import { Link } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { TextAreaField, TextField } from '#/components/form'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { FieldGroup, FieldLegend, FieldSet } from '#/components/ui/field'
import { formatDocument, formatPhone } from '#/lib/masks'
import { fieldErrors, type OwnerInput, ownerSchema } from '#/lib/schemas'

export interface OwnerFormValues {
  name: string
  document: string
  phone: string
  email: string
  notes: string
}

export const emptyOwner: OwnerFormValues = {
  name: '',
  document: '',
  phone: '',
  email: '',
  notes: '',
}

export function ownerToForm(owner: {
  name: string
  document: string | null
  phone: string | null
  email: string | null
  notes: string | null
}): OwnerFormValues {
  return {
    name: owner.name,
    document: owner.document ?? '',
    phone: owner.phone ?? '',
    email: owner.email ?? '',
    notes: owner.notes ?? '',
  }
}

export function OwnerForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  aside,
  footer,
}: {
  initial: OwnerFormValues
  submitLabel: string
  pending: boolean
  onSubmit: (values: OwnerInput) => Promise<unknown>
  /** Shown under the fields (e.g. the owner's chácaras). */
  aside?: ReactNode
  footer?: ReactNode
}) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})

  function set<K extends keyof OwnerFormValues>(key: K) {
    return (value: OwnerFormValues[K]) =>
      setValues((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = ownerSchema.safeParse(values)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      toast.error('Confira os campos destacados.')
      return
    }
    setErrors({})
    await onSubmit(values)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Card>
        <CardContent>
          <FieldSet>
            <FieldLegend className="text-xl font-bold">
              Dados do proprietário
            </FieldLegend>
            <FieldGroup className="grid gap-6 md:grid-cols-2">
              <TextField
                label="Nome"
                error={errors.name}
                value={values.name}
                onChange={set('name')}
                autoComplete="name"
                required
                className="md:col-span-2"
              />
              <TextField
                label="Documento pessoal"
                description="CPF ou RG."
                error={errors.document}
                value={values.document}
                onChange={set('document')}
                onBlur={() => set('document')(formatDocument(values.document))}
              />
              <TextField
                label="Contato"
                description="Telefone ou celular com DDD."
                error={errors.phone}
                value={values.phone}
                onChange={(value) => set('phone')(formatPhone(value))}
                inputMode="tel"
                autoComplete="tel"
              />
              <TextField
                label="E-mail"
                error={errors.email}
                value={values.email}
                onChange={set('email')}
                type="email"
                autoComplete="email"
                className="md:col-span-2"
              />
              <TextAreaField
                label="Observações"
                error={errors.notes}
                value={values.notes}
                onChange={set('notes')}
                className="md:col-span-2"
              />
            </FieldGroup>
          </FieldSet>
        </CardContent>
      </Card>

      {aside}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? 'Salvando…' : submitLabel}
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link to="/cadastros/proprietarios">Cancelar</Link>
          </Button>
        </div>
        {footer}
      </div>
    </form>
  )
}
