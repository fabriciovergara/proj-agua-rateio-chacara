import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '#/db/client.server'
import { createSession, setAppPassword } from './auth.server'
import { createBackup } from './backup.server'
import { createOwner } from './owners.server'

test('the backup is a complete SQLite database, without sessions', async () => {
  const db = openDatabase(':memory:')
  createOwner(db, {
    name: 'Ana',
    document: '',
    phone: '',
    email: '',
    notes: '',
  })

  await setAppPassword(db, { current: '', password: 'chacara-15' })
  createSession(db)

  const bytes = await createBackup(db)
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rateio-test-'))
  try {
    const file = path.join(directory, 'copy.sqlite')
    writeFileSync(file, new Uint8Array(bytes))
    const copy = new Database(file, { readonly: true })
    expect(copy.query('select name from owners').all()).toEqual([
      { name: 'Ana' },
    ])
    // Keeps the password, leaves out the unlocked devices.
    expect(copy.query('select count(*) as n from app_password').get()).toEqual({
      n: 1,
    })
    expect(copy.query('select count(*) as n from sessions').get()).toEqual({
      n: 0,
    })
    copy.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
