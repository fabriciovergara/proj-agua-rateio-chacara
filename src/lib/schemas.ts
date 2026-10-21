import { z } from 'zod'
import { ACCOUNT_TYPES, PIX_KEY_TYPES, STATES } from './domain'
import { MAX_PIX_KEY_LENGTH, validatePixKey } from './pix'

/*
 * Validation shared by the forms (instant feedback) and the server functions
 * (the source of truth). Messages are written for the people using the app.
 */

/*
 * Optional fields accept what forms send ("" for empty) and also null, so
 * parsing an already-parsed value is a no-op. That lets the server functions
 * validate at the network boundary and the repositories validate again for
 * scripts and tests.
 */

/** Optional text: empty strings are stored as null. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .nullable()
    .transform((value) => (value === '' ? null : value))
}

function requiredText(max: number, message: string) {
  return z
    .string()
    .trim()
    .min(1, message)
    .max(max, `Use no máximo ${max} caracteres.`)
}

/** Select fields send "" for "none". */
function optionalEnum<const T extends readonly [string, ...string[]]>(
  values: T,
) {
  return z
    .union([z.enum(values), z.literal(''), z.null()])
    .transform((value) => (value === '' ? null : value))
}

export const idSchema = z.number().int().positive()

export const yearSchema = z
  .number()
  .int()
  .min(2000, 'Ano inválido.')
  .max(2100, 'Ano inválido.')

export const monthSchema = z
  .number()
  .int()
  .min(1, 'Mês inválido.')
  .max(12, 'Mês inválido.')

export const periodSchema = z.object({ year: yearSchema, month: monthSchema })

const meterValue = z
  .number({ error: 'Informe a leitura.' })
  .int('Use apenas números inteiros.')
  .min(0, 'A leitura não pode ser negativa.')
  .max(999_999_999, 'Leitura muito grande.')

const cents = z.number().int().min(0, 'O valor não pode ser negativo.')

/** Price per kWh in micros; above R$ 100/kWh is surely a typo. */
const kwhPrice = z
  .number()
  .int()
  .min(0, 'O preço não pode ser negativo.')
  .max(100_000_000, 'Preço do kWh muito alto. Confira o valor.')

export const ownerSchema = z.object({
  name: requiredText(120, 'Informe o nome do proprietário.'),
  document: optionalText(40),
  phone: optionalText(40),
  email: optionalText(120).refine(
    (value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    'Informe um e-mail válido, como nome@exemplo.com.',
  ),
  notes: optionalText(1000),
})
export type OwnerInput = z.input<typeof ownerSchema>

export const propertySchema = z.object({
  name: requiredText(120, 'Informe o nome da chácara.'),
  ownerId: idSchema.nullable(),
  street: optionalText(160),
  number: optionalText(20),
  district: optionalText(80),
  city: optionalText(80),
  state: optionalEnum(STATES),
  zipCode: optionalText(9).refine(
    (value) => value === null || /^\d{5}-?\d{3}$/.test(value),
    'O CEP tem 8 números, como 13250-000.',
  ),
  meterNumber: optionalText(40),
  active: z.boolean(),
  notes: optionalText(1000),
})
export type PropertyInput = z.input<typeof propertySchema>

/** What is printed on every bill (Configurações). */
export const settingsSchema = z.object({
  groupName: optionalText(80),
  dueDay: z
    .number()
    .int()
    .min(1, 'Escolha um dia entre 1 e 31.')
    .max(31, 'Escolha um dia entre 1 e 31.')
    .nullable(),
})
export type SettingsInput = z.input<typeof settingsSchema>

/** kWh price and reserve fund of one month (Leituras). */
export const monthRatesSchema = z.object({
  kwhPriceMicros: kwhPrice,
  reserveFundCents: cents.max(
    10_000_000,
    'Fundo de reserva muito alto. Confira o valor.',
  ),
})
export type MonthRatesInput = z.input<typeof monthRatesSchema>

export const bankAccountSchema = z
  .object({
    bankName: optionalText(80),
    bankCode: optionalText(10),
    branch: optionalText(20),
    accountNumber: optionalText(30),
    accountType: optionalEnum(ACCOUNT_TYPES),
    pixKeyType: optionalEnum(PIX_KEY_TYPES),
    pixKey: optionalText(MAX_PIX_KEY_LENGTH),
    holderName: optionalText(80),
    holderCity: optionalText(40),
  })
  .superRefine((value, ctx) => {
    if (!value.pixKey) return
    if (!value.pixKeyType) {
      ctx.addIssue({
        code: 'custom',
        path: ['pixKeyType'],
        message: 'Escolha o tipo da chave Pix.',
      })
      return
    }
    const problem = validatePixKey(value.pixKey, value.pixKeyType)
    if (problem) {
      ctx.addIssue({ code: 'custom', path: ['pixKey'], message: problem })
    }
  })
export type BankAccountInput = z.input<typeof bankAccountSchema>

const consumptionRule = {
  check: (value: { previousReading: number; currentReading: number }) =>
    value.currentReading >= value.previousReading,
  params: {
    path: ['currentReading'],
    message: 'A leitura atual não pode ser menor que a anterior.',
  },
}

export const readingSchema = z
  .object({
    propertyId: idSchema,
    year: yearSchema,
    month: monthSchema,
    previousReading: meterValue,
    currentReading: meterValue,
    kwhPriceMicros: kwhPrice,
    reserveFundCents: cents,
    paid: z.boolean(),
    /** The person confirmed a "leitura anterior" off the chain (new meter). */
    confirmPreviousChange: z.boolean().optional(),
  })
  .refine(consumptionRule.check, consumptionRule.params)
export type ReadingInput = z.input<typeof readingSchema>

export const updateReadingSchema = z
  .object({
    id: idSchema,
    year: yearSchema,
    month: monthSchema,
    previousReading: meterValue,
    currentReading: meterValue,
    kwhPriceMicros: kwhPrice,
    reserveFundCents: cents,
    paid: z.boolean(),
    confirmPreviousChange: z.boolean().optional(),
  })
  .refine(consumptionRule.check, consumptionRule.params)
export type UpdateReadingInput = z.input<typeof updateReadingSchema>

export const monthEntriesSchema = z.object({
  year: yearSchema,
  month: monthSchema,
  /** The month's values; unpaid bills of the month follow them. */
  rates: monthRatesSchema,
  entries: z
    .array(
      z.object({
        propertyId: idSchema,
        currentReading: meterValue,
        /** Only needed for the very first reading of a chácara. */
        previousReading: meterValue.optional(),
      }),
    )
    .max(500),
})
export type MonthEntriesInput = z.input<typeof monthEntriesSchema>

export const setPaidSchema = z.object({ id: idSchema, paid: z.boolean() })

/** First message per field, for showing next to each input. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_')
    result[key] ??= issue.message
  }
  return result
}
