import { eq } from 'drizzle-orm'
import type { Executor } from '#/db/client.server'
import { bankAccount, settings } from '#/db/schema'
import type { BankAccountInput, SettingsInput } from '#/lib/schemas'
import { bankAccountSchema, settingsSchema } from '#/lib/schemas'

const SINGLETON_ID = 1

/** Group name and due day, printed on every bill. */
export function getSettings(db: Executor) {
  return (
    db.select().from(settings).where(eq(settings.id, SINGLETON_ID)).get() ??
    null
  )
}

export function saveSettings(db: Executor, input: SettingsInput) {
  const values = settingsSchema.parse(input)
  return db
    .insert(settings)
    .values({ id: SINGLETON_ID, ...values })
    .onConflictDoUpdate({
      target: settings.id,
      set: { ...values, updatedAt: new Date() },
    })
    .returning()
    .get()
}

export function getBankAccount(db: Executor) {
  return (
    db
      .select()
      .from(bankAccount)
      .where(eq(bankAccount.id, SINGLETON_ID))
      .get() ?? null
  )
}

export function saveBankAccount(db: Executor, input: BankAccountInput) {
  const values = bankAccountSchema.parse(input)
  return db
    .insert(bankAccount)
    .values({ id: SINGLETON_ID, ...values })
    .onConflictDoUpdate({
      target: bankAccount.id,
      set: { ...values, updatedAt: new Date() },
    })
    .returning()
    .get()
}

export function clearBankAccount(db: Executor) {
  db.delete(bankAccount).where(eq(bankAccount.id, SINGLETON_ID)).run()
}
