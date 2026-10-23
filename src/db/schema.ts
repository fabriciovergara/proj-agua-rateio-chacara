import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { ACCOUNT_TYPES, PIX_KEY_TYPES } from '#/lib/domain'

/*
 * Money is stored as integers to avoid floating point errors: values in R$
 * are stored in centavos (`*_cents`). Meter readings are whole m³, and dates
 * are ISO text (YYYY-MM-DD), which sorts and compares as dates.
 */

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
}

/** A single row (id = 1) with what is printed on every bill. */
export const settings = sqliteTable(
  'settings',
  {
    id: integer('id').primaryKey(),
    groupName: text('group_name'),
    dueDay: integer('due_day'),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [check('settings_singleton', sql`${t.id} = 1`)],
)

/**
 * A billing period ("Leituras"): from the day the meters were read before to
 * the day they are read now, the pump's electricity bill for those days and
 * the reserve fund. Periods never overlap, though one may start on the day
 * the other ends. A chácara read on other days keeps its own dates in its
 * reading.
 */
export const periods = sqliteTable(
  'periods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    /**
     * The pump's electricity bill, split among the chácaras by the m³ each
     * one used. Null until the bill arrives.
     */
    energyBillCents: integer('energy_bill_cents'),
    /** Charged to every chácara read in the period. */
    reserveFundCents: integer('reserve_fund_cents').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('periods_start_uq').on(t.startDate),
    check('periods_dates', sql`${t.startDate} < ${t.endDate}`),
  ],
)

/**
 * Password set in Configurações to unlock the app (argon2id hash). Kept apart
 * from `settings` so it can never travel to the browser with them.
 */
export const appPassword = sqliteTable(
  'app_password',
  {
    id: integer('id').primaryKey(),
    hash: text('hash').notNull(),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [check('app_password_singleton', sql`${t.id} = 1`)],
)

/**
 * Unlocked browsers. Only a hash of the cookie token is stored, and
 * `credentials` ties the session to the passwords in force when it was
 * created: changing any password signs every browser out.
 */
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  credentials: text('credentials').notNull(),
  /** Unlocked with APP_PASSWORD: may also import data and wipe it all. */
  withEnvPassword: integer('with_env_password', { mode: 'boolean' })
    .notNull()
    .default(false),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: timestamps.createdAt,
})

/** "Dados Bancários": a single row (id = 1) with where owners should pay. */
export const bankAccount = sqliteTable(
  'bank_account',
  {
    id: integer('id').primaryKey(),
    bankName: text('bank_name'),
    bankCode: text('bank_code'),
    branch: text('branch'),
    accountNumber: text('account_number'),
    accountType: text('account_type', { enum: ACCOUNT_TYPES }),
    pixKeyType: text('pix_key_type', { enum: PIX_KEY_TYPES }),
    pixKey: text('pix_key'),
    holderName: text('holder_name'),
    holderCity: text('holder_city'),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [check('bank_account_singleton', sql`${t.id} = 1`)],
)

/** "Dados dos proprietários". */
export const owners = sqliteTable('owners', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  document: text('document'),
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  ...timestamps,
})

/** "Dados do Imóvel": each chácara has one meter and (optionally) one owner. */
export const properties = sqliteTable(
  'properties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    ownerId: integer('owner_id').references(() => owners.id, {
      onDelete: 'set null',
    }),
    street: text('street'),
    number: text('number'),
    district: text('district'),
    city: text('city'),
    state: text('state'),
    zipCode: text('zip_code'),
    meterNumber: text('meter_number'),
    /** Inactive chácaras are hidden from the monthly readings screen. */
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [index('properties_owner_idx').on(t.ownerId)],
)

/**
 * One water meter reading per chácara per period. The share of the
 * electricity bill and the reserve fund are stored with it: unpaid bills
 * follow every change in the period, paid bills keep what was charged.
 */
export const readings = sqliteTable(
  'readings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    periodId: integer('period_id')
      .notNull()
      .references(() => periods.id, { onDelete: 'cascade' }),
    /** m³ on the meter at the previous reading ("Última leitura"). */
    previousReading: integer('previous_reading').notNull(),
    /** m³ on the meter now ("Leitura atual"). */
    currentReading: integer('current_reading').notNull(),
    /**
     * When the meter was read before, kept only for a chácara's first
     * reading (later ones start when the one before ended). Null: the
     * period's start.
     */
    startDate: text('start_date'),
    /** When the meter was read. Null: the period's end. */
    endDate: text('end_date'),
    /** Share of the period's electricity bill; null until it is known. */
    energyCents: integer('energy_cents'),
    reserveFundCents: integer('reserve_fund_cents').notNull(),
    paid: integer('paid', { mode: 'boolean' }).notNull().default(false),
    /** ISO date (YYYY-MM-DD). */
    paidAt: text('paid_at'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('readings_property_period_uq').on(t.propertyId, t.periodId),
    index('readings_period_idx').on(t.periodId),
    check(
      'readings_consumption_non_negative',
      sql`${t.currentReading} >= ${t.previousReading}`,
    ),
    check(
      'readings_paid_has_amount',
      sql`${t.paid} = 0 or ${t.energyCents} is not null`,
    ),
  ],
)

export type Settings = typeof settings.$inferSelect
export type Period = typeof periods.$inferSelect
export type BankAccount = typeof bankAccount.$inferSelect
export type Owner = typeof owners.$inferSelect
export type Property = typeof properties.$inferSelect
export type Reading = typeof readings.$inferSelect
