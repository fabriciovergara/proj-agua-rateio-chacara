import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { ACCOUNT_TYPES, PIX_KEY_TYPES } from '#/lib/domain'

/*
 * Money is stored as integers to avoid floating point errors:
 *  - values in R$ are stored in centavos (`*_cents`)
 *  - the kWh price is stored in millionths of a real (`*_micros`) because
 *    electricity tariffs often have more than two decimal places.
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
 * kWh price and reserve fund of each month, typed on the "Leituras" screen.
 * Readings copy them, so a paid bill keeps the values it was charged with.
 */
export const monthRates = sqliteTable(
  'month_rates',
  {
    year: integer('year').notNull(),
    month: integer('month').notNull(),
    kwhPriceMicros: integer('kwh_price_micros').notNull(),
    reserveFundCents: integer('reserve_fund_cents').notNull(),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    primaryKey({ columns: [t.year, t.month] }),
    check('month_rates_month_range', sql`${t.month} between 1 and 12`),
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
 * One meter reading per chácara per month. The kWh price and the reserve fund
 * are copied from the month's values, so paid bills never change afterwards.
 */
export const readings = sqliteTable(
  'readings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    propertyId: integer('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    month: integer('month').notNull(),
    previousReading: integer('previous_reading').notNull(),
    currentReading: integer('current_reading').notNull(),
    kwhPriceMicros: integer('kwh_price_micros').notNull(),
    reserveFundCents: integer('reserve_fund_cents').notNull(),
    paid: integer('paid', { mode: 'boolean' }).notNull().default(false),
    /** ISO date (YYYY-MM-DD). */
    paidAt: text('paid_at'),
    /** ISO date (YYYY-MM-DD). */
    readingDate: text('reading_date'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('readings_property_period_uq').on(
      t.propertyId,
      t.year,
      t.month,
    ),
    index('readings_period_idx').on(t.year, t.month),
    check('readings_month_range', sql`${t.month} between 1 and 12`),
    check(
      'readings_consumption_non_negative',
      sql`${t.currentReading} >= ${t.previousReading}`,
    ),
  ],
)

export type Settings = typeof settings.$inferSelect
export type MonthRates = typeof monthRates.$inferSelect
export type BankAccount = typeof bankAccount.$inferSelect
export type Owner = typeof owners.$inferSelect
export type Property = typeof properties.$inferSelect
export type Reading = typeof readings.$inferSelect
