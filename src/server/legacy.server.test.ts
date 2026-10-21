import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { asc } from 'drizzle-orm'
import { openDatabase } from '#/db/client.server'
import {
  appPassword,
  monthRates,
  owners,
  properties,
  readings,
} from '#/db/schema'
import { setAppPassword } from './auth.server'
import {
  describeLegacyImport,
  importLegacy,
  legacyMoneyToCents,
  legacyPriceToMicros,
  legacyPropertyName,
  parseLegacyCsv,
  parseLegacyDate,
  parseLegacyPeriod,
  prefillFromLegacy,
} from './legacy.server'
import { createOwner } from './owners.server'

describe('parseLegacyPeriod', () => {
  test.each([
    ['10 Jan/10 Fev 2007', 2007, { year: 2007, month: 2 }],
    ['10 Abr/ 10Mai 2007', 2007, { year: 2007, month: 5 }],
    ['10 Abr/10  Mai 2007', 2007, { year: 2007, month: 5 }],
    ['10 Nov 07/ 10 Jan 08', 2007, { year: 2008, month: 1 }],
    ['10 Dez 08 / 10 jan 09', 2009, { year: 2009, month: 1 }],
    ['10 Jun 08 / 10 Lul 08', 2008, { year: 2008, month: 7 }],
    ['10  Fev 08 /10 Mar 08', 2008, { year: 2008, month: 3 }],
    ['10 Set 08 / 10 dez 08', 2008, { year: 2008, month: 12 }],
    ['10 Out / 10 Nov 2007', 2007, { year: 2007, month: 11 }],
  ])('%p → %p', (mes, fallback, expected) => {
    expect(parseLegacyPeriod(mes, fallback)).toEqual(expected)
  })

  test('falls back to the year column when the text has none', () => {
    expect(parseLegacyPeriod('10 Jan / 10 Fev', 2008)).toEqual({
      year: 2008,
      month: 2,
    })
    expect(parseLegacyPeriod('', 2008)).toBeNull()
  })
})

describe('legacy values', () => {
  test('dates are month-first', () => {
    expect(parseLegacyDate('02/15/07 00:00:00')).toBe('2007-02-15')
    expect(parseLegacyDate('')).toBeNull()
  })

  test('Access singles become exact integers', () => {
    expect(legacyPriceToMicros('0.34999999')).toBe(350000)
    expect(legacyPriceToMicros('0.34')).toBe(340000)
    expect(legacyMoneyToCents('10')).toBe(1000)
  })

  test('chácara names come from the address column', () => {
    expect(legacyPropertyName('Chácara 14', 'Helena')).toBe('Chácara 14')
    expect(legacyPropertyName('(12)', 'Otávio')).toBe('Chácara 12')
    expect(legacyPropertyName('13)', 'Rosa')).toBe('Chácara 13')
    expect(legacyPropertyName('Chácara', 'Teodoro')).toBe('Chácara Teodoro')
  })
})

/*
 * A small export in the format mdb-export writes (text quoted, numbers
 * bare). Fictitious people only: never copy rows of the real Kw.mdb here.
 */
const USERS = `CodigoUsr,Usuario,CPF,Endereco,Telefone,Celular,Hidrometro,Observacoes
1,"Zuleica Fictícia",,"Chácara 7",,"(11) 90000-0001","H-0007",
2,"Quirino Exemplo",,"(9)","(11) 3000-0002",,"H-0009","Portão azul"
`
const INVOICES = `NumeroFatura,CodigoUsr,Data
1,1,"01/10/07 00:00:00"
2,2,"01/10/07 00:00:00"
`
const CONSUMPTION = `CodigoCosumo,NumeroFatura,LeituraAtual,LeituraAnterior,Valor,Fundo,Mes,Data,Vencimento,Quitado,Ano
10,1,120,100,0.34999999,10,"10 Jan/10 Fev 2007","02/15/07 00:00:00","20/02/2007",1,"2007"
11,1,150,120,0.34,10,"10 Fev/10 Mar 2007","03/15/07 00:00:00",,0,"2007"
12,2,60,50,0.34999999,10,"10 Jan/10 Fev 2007","02/15/07 00:00:00",,1,"2007"
13,2,,,,,,"03/13/07 00:00:00",,0,
14,2,40,50,0.34,10,"10 Fev/10 Mar 2007","03/15/07 00:00:00",,0,"2007"
15,2,65,60,0.34,10,"10 Jan/10 Fev 2007","02/20/07 00:00:00",,0,"2007"
16,3,10,5,0.34,10,"10 Jan/10 Fev 2007","02/15/07 00:00:00",,0,"2007"
`

const legacyExport = () => ({
  users: parseLegacyCsv(USERS),
  invoices: parseLegacyCsv(INVOICES),
  consumption: parseLegacyCsv(CONSUMPTION),
})

describe('importLegacy', () => {
  test('each old user becomes an owner with a chácara', () => {
    const db = openDatabase(':memory:')
    importLegacy(db, legacyExport())

    expect(
      db
        .select({ name: owners.name, phone: owners.phone, notes: owners.notes })
        .from(owners)
        .orderBy(asc(owners.id))
        .all(),
    ).toEqual([
      {
        name: 'Zuleica Fictícia',
        phone: '(11) 90000-0001',
        notes: 'Importado do sistema antigo (código 1).',
      },
      {
        name: 'Quirino Exemplo',
        phone: '(11) 3000-0002',
        notes: 'Portão azul\nImportado do sistema antigo (código 2).',
      },
    ])
    expect(
      db
        .select({ name: properties.name, meter: properties.meterNumber })
        .from(properties)
        .orderBy(asc(properties.id))
        .all(),
    ).toEqual([
      { name: 'Chácara 7', meter: 'H-0007' },
      { name: 'Chácara 9', meter: 'H-0009' },
    ])
  })

  test('readings keep the price and fund they were billed with', () => {
    const db = openDatabase(':memory:')
    expect(importLegacy(db, legacyExport()).readings).toBe(3)

    expect(
      db
        .select({
          propertyId: readings.propertyId,
          year: readings.year,
          month: readings.month,
          previous: readings.previousReading,
          current: readings.currentReading,
          price: readings.kwhPriceMicros,
          fund: readings.reserveFundCents,
          paid: readings.paid,
          readingDate: readings.readingDate,
          notes: readings.notes,
        })
        .from(readings)
        .orderBy(asc(readings.id))
        .all(),
    ).toEqual([
      {
        propertyId: 1,
        year: 2007,
        month: 2,
        previous: 100,
        current: 120,
        price: 350000,
        fund: 1000,
        paid: true,
        readingDate: '2007-02-15',
        notes:
          'Período no sistema antigo: 10 Jan/10 Fev 2007, vencimento 20/02/2007',
      },
      {
        propertyId: 1,
        year: 2007,
        month: 3,
        previous: 120,
        current: 150,
        price: 340000,
        fund: 1000,
        paid: false,
        readingDate: '2007-03-15',
        notes: 'Período no sistema antigo: 10 Fev/10 Mar 2007',
      },
      {
        propertyId: 2,
        year: 2007,
        month: 2,
        previous: 50,
        current: 60,
        price: 350000,
        fund: 1000,
        paid: true,
        readingDate: '2007-02-15',
        notes: 'Período no sistema antigo: 10 Jan/10 Fev 2007',
      },
    ])
    // Each month gets the values most of its bills used.
    expect(
      db
        .select({
          year: monthRates.year,
          month: monthRates.month,
          price: monthRates.kwhPriceMicros,
          fund: monthRates.reserveFundCents,
        })
        .from(monthRates)
        .orderBy(asc(monthRates.year), asc(monthRates.month))
        .all(),
    ).toEqual([
      { year: 2007, month: 2, price: 350000, fund: 1000 },
      { year: 2007, month: 3, price: 340000, fund: 1000 },
    ])
  })

  test('rows that cannot be imported are listed, not guessed', () => {
    const db = openDatabase(':memory:')
    const result = importLegacy(db, legacyExport())

    expect(describeLegacyImport(result)).toBe(
      [
        'Importados 2 proprietários/chácaras e 3 leituras.',
        '4 registros não importados:',
        '  - registro 13: sem leitura',
        '  - registro 14: leitura atual menor que a anterior',
        '  - registro 15: Chácara 9 já tem leitura de Fevereiro de 2007',
        '  - registro 16: fatura 3 sem usuário',
      ].join('\n'),
    )
  })

  test('reset replaces the data but keeps the password', async () => {
    const db = openDatabase(':memory:')
    await setAppPassword(db, { current: '', password: 'chacara-15' })
    importLegacy(db, legacyExport())
    importLegacy(db, legacyExport(), { reset: true })

    expect(db.select().from(owners).all()).toHaveLength(2)
    expect(db.select().from(readings).all()).toHaveLength(3)
    expect(db.select().from(appPassword).all()).toHaveLength(1)
  })
})

describe('prefillFromLegacy', () => {
  let folder: string | undefined

  function writeExport(
    files: Record<string, string> = {
      'T_Usuarios.csv': USERS,
      'T_Fatura.csv': INVOICES,
      'T_Consumo.csv': CONSUMPTION,
    },
  ) {
    folder = mkdtempSync(path.join(os.tmpdir(), 'rateio-legacy-'))
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(folder, name), content)
    }
    return folder
  }

  afterEach(() => {
    if (folder) rmSync(folder, { recursive: true, force: true })
    folder = undefined
  })

  test('fills an empty database once, keeping the password', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const db = openDatabase(':memory:')
      await setAppPassword(db, { current: '', password: 'chacara-15' })
      const dir = writeExport()

      expect(prefillFromLegacy(db, dir)?.readings).toBe(3)
      expect(log).toHaveBeenCalledTimes(1)
      // From then on the files are left alone, even if still there.
      expect(prefillFromLegacy(db, dir)).toBeNull()
      expect(db.select().from(owners).all()).toHaveLength(2)
      expect(db.select().from(readings).all()).toHaveLength(3)
      expect(db.select().from(appPassword).all()).toHaveLength(1)
    } finally {
      log.mockRestore()
    }
  })

  test('leaves a database with data typed in alone', () => {
    const db = openDatabase(':memory:')
    createOwner(db, {
      name: 'Dona Exemplo',
      document: '',
      phone: '',
      email: '',
      notes: '',
    })

    expect(prefillFromLegacy(db, '/pasta/que/nao/existe')).toBeNull()
    expect(db.select().from(owners).all()).toHaveLength(1)
  })

  test('a missing file stops it before anything is written', () => {
    const db = openDatabase(':memory:')
    const dir = writeExport({
      'T_Usuarios.csv': USERS,
      'T_Fatura.csv': INVOICES,
    })

    expect(() => prefillFromLegacy(db, dir)).toThrow(
      `Arquivo não encontrado: ${path.join(dir, 'T_Consumo.csv')}`,
    )
    expect(db.select().from(owners).all()).toHaveLength(0)
  })
})
