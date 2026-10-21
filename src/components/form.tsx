import { cn } from 'cn'
import {
  type ComponentProps,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '#/components/ui/input-group'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'
import { Textarea } from '#/components/ui/textarea'
import {
  centsToInput,
  formatNumber,
  microsToInput,
  parseCents,
  parsePriceMicros,
} from '#/lib/money'

/*
 * Form building blocks on top of shadcn's Field: each one wires the label,
 * the description and the error message to its control for screen readers.
 */

interface ControlProps {
  id: string
  'aria-invalid': boolean
  'aria-describedby'?: string
}

export function FormField({
  label,
  description,
  error,
  className,
  children,
}: {
  label: ReactNode
  description?: ReactNode
  error?: string
  className?: string
  children: (props: ControlProps) => ReactNode
}) {
  const id = useId()
  const descriptionId = description ? `${id}-descricao` : undefined
  const errorId = error ? `${id}-erro` : undefined

  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby':
          [descriptionId, errorId].filter(Boolean).join(' ') || undefined,
      })}
      {description && !error && (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  )
}

export function TextField({
  label,
  description,
  error,
  value,
  onChange,
  className,
  ...inputProps
}: {
  label: ReactNode
  description?: ReactNode
  error?: string
  value: string
  onChange: (value: string) => void
  className?: string
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'className' | 'id'>) {
  return (
    <FormField
      label={label}
      description={description}
      error={error}
      className={className}
    >
      {(props) => (
        <Input
          {...inputProps}
          {...props}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  )
}

export function TextAreaField({
  label,
  description,
  error,
  value,
  onChange,
  className,
}: {
  label: ReactNode
  description?: ReactNode
  error?: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <FormField
      label={label}
      description={description}
      error={error}
      className={className}
    >
      {(props) => (
        <Textarea
          {...props}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  )
}

export function SelectField({
  label,
  description,
  error,
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  label: ReactNode
  description?: ReactNode
  error?: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  /** Label of the empty option; omit to force a choice. */
  placeholder?: string
  className?: string
}) {
  return (
    <FormField
      label={label}
      description={description}
      error={error}
      className={className}
    >
      {(props) => (
        <NativeSelect
          {...props}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {placeholder !== undefined && (
            <NativeSelectOption value="">{placeholder}</NativeSelectOption>
          )}
          {options.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
    </FormField>
  )
}

/**
 * Money typed the Brazilian way ("1.234,56"): an input group with "R$".
 * Accepts "10", "10,5" or "R$ 10,50" and tidies the text on blur.
 */
export function MoneyInput({
  value,
  onChange,
  kind = 'cents',
  className,
  ...props
}: {
  value: string
  onChange: (value: string) => void
  /** `price` allows up to 4 decimal places (kWh tariffs). */
  kind?: 'cents' | 'price'
  className?: string
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'className'>) {
  function tidy() {
    if (kind === 'price') {
      const micros = parsePriceMicros(value)
      if (micros !== null) onChange(microsToInput(micros))
    } else {
      const cents = parseCents(value)
      if (cents !== null) onChange(centsToInput(cents))
    }
  }

  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <InputGroupText>R$</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        {...props}
        className="tabular-nums"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => {
          tidy()
          props.onBlur?.(event)
        }}
      />
    </InputGroup>
  )
}

/** Looks like the counter on the meter: dark wheels, white digits. */
export const meterInputClass =
  'h-auto min-h-13 rounded-md border-2 border-counter bg-counter px-3 py-1.5 text-right font-mono text-[1.55rem] font-semibold tracking-[0.14em] text-white tabular-nums shadow-[inset_0_2px_0_rgb(0_0_0/0.35)] placeholder:text-[#7d8699] focus-visible:border-ring focus-visible:ring-ring/60 aria-invalid:border-[#f2867d] aria-invalid:ring-2 aria-invalid:ring-destructive data-[dirty=true]:border-ring md:text-[1.55rem]'

/**
 * Digits only. While typing the digits are plain; afterwards they get
 * thousands separators like the rest of the screen ("12296" → "12.296").
 */
export function MeterInput({
  value,
  onChange,
  dirty,
  className,
  ...props
}: {
  value: string
  onChange: (value: string) => void
  dirty?: boolean
  className?: string
} & Omit<ComponentProps<'input'>, 'value' | 'onChange'>) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const shown = editing || value === '' ? value : formatNumber(Number(value))

  // Switching to the plain digits drops the selection; select again so that
  // typing replaces the number (as in a spreadsheet) instead of appending.
  useLayoutEffect(() => {
    if (editing) ref.current?.select()
  }, [editing])

  return (
    <Input
      {...props}
      ref={ref}
      className={cn(meterInputClass, className)}
      inputMode="numeric"
      autoComplete="off"
      maxLength={11}
      data-dirty={dirty || undefined}
      value={shown}
      onFocus={(event) => {
        setEditing(true)
        props.onFocus?.(event)
      }}
      onBlur={(event) => {
        setEditing(false)
        props.onBlur?.(event)
      }}
      onChange={(event) =>
        onChange(event.target.value.replace(/\D/g, '').slice(0, 9))
      }
    />
  )
}
