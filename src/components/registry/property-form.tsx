import { Link } from '@tanstack/react-router'
import { MapPin } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import {
  FormField,
  SelectField,
  TextAreaField,
  TextField,
} from '#/components/form'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '#/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '#/components/ui/input-group'
import { STATES } from '#/lib/domain'
import { formatCep } from '#/lib/masks'
import { fieldErrors, type PropertyInput, propertySchema } from '#/lib/schemas'

export interface PropertyFormValues {
  name: string
  ownerId: string
  street: string
  number: string
  district: string
  city: string
  state: string
  zipCode: string
  meterNumber: string
  active: boolean
  notes: string
}

export const emptyProperty: PropertyFormValues = {
  name: '',
  ownerId: '',
  street: '',
  number: '',
  district: '',
  city: '',
  state: '',
  zipCode: '',
  meterNumber: '',
  active: true,
  notes: '',
}

export function propertyToForm(property: {
  name: string
  ownerId: number | null
  street: string | null
  number: string | null
  district: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  meterNumber: string | null
  active: boolean
  notes: string | null
}): PropertyFormValues {
  return {
    name: property.name,
    ownerId: property.ownerId ? String(property.ownerId) : '',
    street: property.street ?? '',
    number: property.number ?? '',
    district: property.district ?? '',
    city: property.city ?? '',
    state: property.state ?? '',
    zipCode: property.zipCode ?? '',
    meterNumber: property.meterNumber ?? '',
    active: property.active,
    notes: property.notes ?? '',
  }
}

interface ViaCepAddress {
  erro?: boolean
  logradouro?: string
  bairro?: string
  localidade?: string
  uf?: string
}

export function PropertyForm({
  initial,
  owners,
  submitLabel,
  pending,
  onSubmit,
  footer,
}: {
  initial: PropertyFormValues
  owners: Array<{ id: number; name: string }>
  submitLabel: string
  pending: boolean
  onSubmit: (values: PropertyInput) => Promise<unknown>
  /** Extra actions next to the buttons (e.g. delete). */
  footer?: ReactNode
}) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [searchingCep, setSearchingCep] = useState(false)

  function set<K extends keyof PropertyFormValues>(key: K) {
    return (value: PropertyFormValues[K]) =>
      setValues((current) => ({ ...current, [key]: value }))
  }

  async function lookupCep(cep = values.zipCode) {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) {
      setErrors((current) => ({
        ...current,
        zipCode: 'O CEP tem 8 números, como 13250-000.',
      }))
      return
    }
    setSearchingCep(true)
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const address = (await response.json()) as ViaCepAddress
      if (address.erro) {
        toast.error('CEP não encontrado. Confira os números.')
        return
      }
      setValues((current) => ({
        ...current,
        street: current.street || address.logradouro || '',
        district: current.district || address.bairro || '',
        city: current.city || address.localidade || '',
        state: current.state || address.uf || '',
      }))
      toast.success('Endereço preenchido pelo CEP.')
    } catch {
      toast.error(
        'Não foi possível buscar o CEP agora. Preencha o endereço à mão.',
      )
    } finally {
      setSearchingCep(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const input: PropertyInput = {
      ...values,
      ownerId: values.ownerId ? Number(values.ownerId) : null,
      state: values.state as PropertyInput['state'],
    }
    const parsed = propertySchema.safeParse(input)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      toast.error('Confira os campos destacados.')
      return
    }
    setErrors({})
    await onSubmit(input)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Card>
        <CardContent>
          <FieldSet>
            <FieldLegend className="text-xl font-bold">
              Identificação
            </FieldLegend>
            <FieldGroup className="grid gap-6 md:grid-cols-2">
              <TextField
                label="Nome da chácara"
                description="Como todos conhecem, por exemplo “Chácara 29”."
                error={errors.name}
                value={values.name}
                onChange={set('name')}
                required
                className="md:col-span-2"
              />
              <TextField
                label="Número do hidrômetro"
                description="O número de série que aparece no medidor."
                error={errors.meterNumber}
                value={values.meterNumber}
                onChange={set('meterNumber')}
              />
              <SelectField
                label="Proprietário"
                description={
                  <>
                    Não está na lista?{' '}
                    <Link to="/cadastros/proprietarios/novo">
                      Cadastre o proprietário
                    </Link>{' '}
                    primeiro.
                  </>
                }
                error={errors.ownerId}
                value={values.ownerId}
                onChange={set('ownerId')}
                placeholder="Sem proprietário"
                options={owners.map((owner) => ({
                  value: String(owner.id),
                  label: owner.name,
                }))}
              />
            </FieldGroup>
          </FieldSet>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <FieldSet>
            <FieldLegend className="text-xl font-bold">Endereço</FieldLegend>
            <FieldGroup className="grid gap-6 md:grid-cols-6">
              <FormField
                label="CEP"
                description="Digite o CEP para preencher o endereço."
                error={errors.zipCode}
                className="md:col-span-2"
              >
                {(props) => (
                  <InputGroup>
                    <InputGroupInput
                      {...props}
                      className="tabular-nums"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      value={values.zipCode}
                      onChange={(event) => {
                        const cep = formatCep(event.target.value)
                        set('zipCode')(cep)
                        if (cep.length === 9 && !values.street) {
                          void lookupCep(cep)
                        }
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        aria-label="Buscar endereço pelo CEP"
                        disabled={searchingCep}
                        onClick={() => void lookupCep()}
                      >
                        <MapPin aria-hidden="true" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                )}
              </FormField>
              <TextField
                label="Logradouro"
                description="Rua, estrada ou avenida."
                error={errors.street}
                value={values.street}
                onChange={set('street')}
                autoComplete="address-line1"
                className="md:col-span-4"
              />
              <TextField
                label="Número"
                error={errors.number}
                value={values.number}
                onChange={set('number')}
                className="md:col-span-1"
              />
              <TextField
                label="Bairro"
                error={errors.district}
                value={values.district}
                onChange={set('district')}
                className="md:col-span-2"
              />
              <TextField
                label="Cidade"
                error={errors.city}
                value={values.city}
                onChange={set('city')}
                autoComplete="address-level2"
                className="md:col-span-2"
              />
              <SelectField
                label="Estado"
                error={errors.state}
                value={values.state}
                onChange={set('state')}
                placeholder="—"
                options={STATES.map((uf) => ({ value: uf, label: uf }))}
                className="md:col-span-1"
              />
            </FieldGroup>
          </FieldSet>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <FieldSet>
            <FieldLegend className="text-xl font-bold">
              Situação e observações
            </FieldLegend>
            <FieldGroup>
              <Field orientation="horizontal">
                <Checkbox
                  id="chacara-ativa"
                  className="size-6 [&_svg]:size-5"
                  checked={values.active}
                  onCheckedChange={(checked) => set('active')(checked === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="chacara-ativa" className="text-base">
                    Chácara ativa
                  </FieldLabel>
                  <FieldDescription>
                    Aparece na tela de leituras todo mês. Desmarque se a chácara
                    deixou de usar a bomba; o histórico continua guardado.
                  </FieldDescription>
                </FieldContent>
              </Field>
              <TextAreaField
                label="Observações"
                error={errors.notes}
                value={values.notes}
                onChange={set('notes')}
              />
            </FieldGroup>
          </FieldSet>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? 'Salvando…' : submitLabel}
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link to="/cadastros/chacaras">Cancelar</Link>
          </Button>
        </div>
        {footer}
      </div>
    </form>
  )
}
