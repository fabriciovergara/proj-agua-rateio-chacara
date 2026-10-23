import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { strToU8, zipSync } from 'fflate'
import { openDatabase } from '#/db/client.server'
import { appPassword, owners, periods, properties, readings } from '#/db/schema'
import { setAppPassword } from './auth.server'
import {
  describeLegacyImport,
  importLegacy,
  legacyEnergyCents,
  legacyMoneyToCents,
  legacyPriceToMicros,
  legacyPropertyName,
  parseLegacyCsv,
  parseLegacyDate,
  parseLegacyPeriod,
  prefillFromLegacy,
  readLegacyZip,
} from './legacy.server'
import { createOwner } from './owners.server'
import { getPropertySheet } from './readings.server'

describe('parseLegacyPeriod', () => {
  const range = (startDate: string, endDate: string) => ({ startDate, endDate })

  test.each([
    ['10 Jan/10 Fev 2007', 2007, range('2007-01-10', '2007-02-10')],
    ['10 Abr/ 10Mai 2007', 2007, range('2007-04-10', '2007-05-10')],
    ['10 Abr/10  Mai 2007', 2007, range('2007-04-10', '2007-05-10')],
    ['10 Nov 07/ 10 Jan 08', 2007, range('2007-11-10', '2008-01-10')],
    ['10 Dez 08 / 10 jan 09', 2009, range('2008-12-10', '2009-01-10')],
    ['10 Jun 08 / 10 Lul 08', 2008, range('2008-06-10', '2008-07-10')],
    ['10  Fev 08 /10 Mar 08', 2008, range('2008-02-10', '2008-03-10')],
    ['10 Set 08 / 10 dez 08', 2008, range('2008-09-10', '2008-12-10')],
    ['10 Out / 10 Nov 2007', 2007, range('2007-10-10', '2007-11-10')],
    ['10 Dez / 10 Jan 2009', 2009, range('2008-12-10', '2009-01-10')],
    ['15 Jan/12 Fev 2007', 2007, range('2007-01-15', '2007-02-12')],
  ])('%p → %p', (mes, fallback, expected) => {
    expect(parseLegacyPeriod(mes, fallback)).toEqual(expected)
  })

  test('falls back to the year column and to a month before', () => {
    expect(parseLegacyPeriod('10 Jan / 10 Fev', 2008)).toEqual(
      range('2008-01-10', '2008-02-10'),
    )
    expect(parseLegacyPeriod('Fev 2008', null)).toEqual(
      range('2008-01-10', '2008-02-10'),
    )
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

  test('energy charged as the old app did: m³ × price per m³', () => {
    // Feb 2007: 461 − 366 = 95 m³ × R$ 0,34 = R$ 32,30.
    expect(legacyEnergyCents(95, 340000)).toBe(3230)
    // 1 m³ × R$ 0,875 = 87,5 centavos → 88.
    expect(legacyEnergyCents(1, 875000)).toBe(88)
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

  test('each month becomes a period, and readings keep what they charged', () => {
    const db = openDatabase(':memory:')
    expect(importLegacy(db, legacyExport()).readings).toBe(3)

    // The bill of each period is what the old app charged for energy.
    expect(
      db
        .select({
          startDate: periods.startDate,
          endDate: periods.endDate,
          bill: periods.energyBillCents,
          fund: periods.reserveFundCents,
        })
        .from(periods)
        .orderBy(asc(periods.startDate))
        .all(),
    ).toEqual([
      {
        startDate: '2007-01-10',
        endDate: '2007-02-10',
        bill: 700 + 350,
        fund: 1000,
      },
      {
        startDate: '2007-02-10',
        endDate: '2007-03-10',
        bill: 1020,
        fund: 1000,
      },
    ])
    expect(
      db
        .select({
          propertyId: readings.propertyId,
          periodId: readings.periodId,
          previous: readings.previousReading,
          current: readings.currentReading,
          energy: readings.energyCents,
          fund: readings.reserveFundCents,
          paid: readings.paid,
          startDate: readings.startDate,
          endDate: readings.endDate,
          notes: readings.notes,
        })
        .from(readings)
        .orderBy(asc(readings.propertyId), asc(readings.periodId))
        .all(),
    ).toEqual([
      {
        propertyId: 1,
        periodId: 1,
        previous: 100,
        current: 120,
        // 20 m³ × R$ 0,35
        energy: 700,
        fund: 1000,
        paid: true,
        startDate: null,
        endDate: null,
        notes:
          'Período no sistema antigo: 10 Jan/10 Fev 2007, vencimento 20/02/2007',
      },
      {
        propertyId: 1,
        periodId: 2,
        previous: 120,
        current: 150,
        // 30 m³ × R$ 0,34
        energy: 1020,
        fund: 1000,
        paid: false,
        startDate: null,
        endDate: null,
        notes: 'Período no sistema antigo: 10 Fev/10 Mar 2007',
      },
      {
        propertyId: 2,
        periodId: 1,
        previous: 50,
        current: 60,
        energy: 350,
        fund: 1000,
        paid: true,
        startDate: null,
        endDate: null,
        notes: 'Período no sistema antigo: 10 Jan/10 Fev 2007',
      },
    ])
  })

  test('a chácara read over two months keeps its dates', () => {
    const db = openDatabase(':memory:')
    importLegacy(db, {
      users: parseLegacyCsv(USERS),
      invoices: parseLegacyCsv(INVOICES),
      consumption:
        parseLegacyCsv(`CodigoCosumo,NumeroFatura,LeituraAtual,LeituraAnterior,Valor,Fundo,Mes,Data,Vencimento,Quitado,Ano
20,2,40,30,0.35,10,"10 Ago 08 / 10 Set 08","09/20/08 00:00:00",,1,"2008"
21,1,110,100,0.35,10,"10 Set 08 / 10 Out 08","10/20/08 00:00:00",,1,"2008"
22,1,130,110,0.35,10,"10 Out 08 / 10 Dez 08","12/20/08 00:00:00",,0,"2008"
23,2,70,40,0.35,10,"10 Set 08 / 10 Dez 08","12/20/08 00:00:00",,0,"2008"
`),
    })

    expect(
      db
        .select({ startDate: periods.startDate, endDate: periods.endDate })
        .from(periods)
        .orderBy(asc(periods.startDate))
        .all(),
    ).toEqual([
      { startDate: '2008-08-10', endDate: '2008-09-10' },
      { startDate: '2008-09-10', endDate: '2008-10-10' },
      { startDate: '2008-10-10', endDate: '2008-12-10' },
    ])
    // Chácara 9 wasn't read in October: its December reading spans both.
    expect(
      getPropertySheet(db, 2)?.readings.map(({ startDate, endDate }) => ({
        startDate,
        endDate,
      })),
    ).toEqual([
      { startDate: '2008-08-10', endDate: '2008-09-10' },
      { startDate: '2008-09-10', endDate: '2008-12-10' },
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
        '  - registro 15: Chácara 9 já tem leitura no período de 10/01/2007 a 10/02/2007',
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

describe('importing over existing data', () => {
  const counts = (db: ReturnType<typeof openDatabase>) => ({
    owners: db.select().from(owners).all().length,
    properties: db.select().from(properties).all().length,
    readings: db.select().from(readings).all().length,
    periods: db.select().from(periods).all().length,
  })

  test('the same export again adds nothing and changes nothing', () => {
    const db = openDatabase(':memory:')
    const first = importLegacy(db, legacyExport())
    const before = counts(db)
    const again = importLegacy(db, legacyExport())

    expect(again).toEqual({
      created: 0,
      matched: 2,
      readings: 0,
      existing: 3,
      skipped: first.skipped,
    })
    expect(counts(db)).toEqual(before)
    expect(describeLegacyImport(again).split('\n').slice(0, 2)).toEqual([
      'Importados 0 proprietários/chácaras e 0 leituras.',
      'Já estavam no app, sem mudanças: 2 chácaras e 3 leituras.',
    ])
  })

  test('a chácara typed in the app gets only the periods it lacks', () => {
    const db = openDatabase(':memory:')
    const owner = createOwner(db, {
      name: 'Dona Exemplo',
      document: '',
      phone: '',
      email: '',
      notes: '',
    })
    const typed = db
      .insert(properties)
      .values({ name: 'chacara  7', ownerId: owner.id })
      .returning()
      .get()
    // March 2007 typed in the app, on other dates.
    const march = db
      .insert(periods)
      .values({
        startDate: '2007-02-12',
        endDate: '2007-03-12',
        energyBillCents: 3600,
        reserveFundCents: 1500,
      })
      .returning()
      .get()
    db.insert(readings)
      .values({
        propertyId: typed.id,
        periodId: march.id,
        previousReading: 120,
        currentReading: 160,
        energyCents: 3600,
        reserveFundCents: 1500,
      })
      .run()

    const result = importLegacy(db, legacyExport())

    expect(result).toMatchObject({
      created: 1,
      matched: 1,
      readings: 2,
      existing: 1,
    })
    // Not duplicated, and its owner stays.
    expect(
      db
        .select({ name: owners.name })
        .from(owners)
        .orderBy(asc(owners.id))
        .all(),
    ).toEqual([{ name: 'Dona Exemplo' }, { name: 'Quirino Exemplo' }])
    // February came; March stays as it was typed, in the app's period.
    expect(
      db
        .select({
          period: periods.endDate,
          current: readings.currentReading,
          energy: readings.energyCents,
        })
        .from(readings)
        .innerJoin(periods, eq(periods.id, readings.periodId))
        .where(eq(readings.propertyId, typed.id))
        .orderBy(asc(periods.startDate))
        .all(),
    ).toEqual([
      { period: '2007-02-10', current: 120, energy: 700 },
      { period: '2007-03-12', current: 160, energy: 3600 },
    ])
    expect(db.select().from(periods).all()).toHaveLength(2)
  })

  test('a renamed chácara is still found by its meter', () => {
    const db = openDatabase(':memory:')
    db.insert(properties)
      .values({ name: 'Sítio do Exemplo', meterNumber: 'h 0009' })
      .run()

    expect(importLegacy(db, legacyExport())).toMatchObject({
      created: 1,
      matched: 1,
    })
    expect(db.select().from(properties).all()).toHaveLength(2)
  })

  test('a name two chácaras share is reported, not guessed', () => {
    const db = openDatabase(':memory:')
    db.insert(properties)
      .values([{ name: 'Chácara 9' }, { name: 'Chácara 9' }])
      .run()

    const result = importLegacy(db, legacyExport())

    expect(result).toMatchObject({ created: 1, matched: 0, readings: 2 })
    expect(result.skipped).toEqual([
      'Chácara 9 (código 2): o app tem mais de uma chácara com esse nome ou hidrômetro; as leituras dela não foram importadas',
      'registro 16: fatura 3 sem usuário',
    ])
  })
})

describe('readLegacyZip', () => {
  const zip = (files: Record<string, string | Uint8Array>) =>
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, content]) => [
          name,
          typeof content === 'string' ? strToU8(content) : content,
        ]),
      ),
    )

  test('finds the CSVs in any folder and leaves other files alone', () => {
    const data = readLegacyZip(
      zip({
        'Rateio/T_Usuarios.csv': USERS,
        'Rateio/T_Fatura.csv': INVOICES,
        // The table's name in Kw.mdb also works.
        'Rateio/T_Cosumo.csv': CONSUMPTION,
        'Rateio/Kw.mdb': new Uint8Array(64),
        '__MACOSX/Rateio/._T_Usuarios.csv': new Uint8Array([0, 5, 22, 7]),
      }),
    )
    expect(data).toEqual(legacyExport())
  })

  test('reads files saved by Windows programs (Windows-1252)', () => {
    const windows1252 = Uint8Array.from(USERS, (char) => char.charCodeAt(0))
    const data = readLegacyZip(
      zip({
        'T_Usuarios.csv': windows1252,
        'T_Fatura.csv': INVOICES,
        'T_Consumo.csv': CONSUMPTION,
      }),
    )
    expect(data.users.map((user) => user.Usuario)).toEqual([
      'Zuleica Fictícia',
      'Quirino Exemplo',
    ])
  })

  test('says what is wrong with the file', () => {
    expect(() =>
      readLegacyZip(
        zip({ 'T_Usuarios.csv': USERS, 'T_Consumo.csv': CONSUMPTION }),
      ),
    ).toThrow('O .zip não tem o arquivo T_Fatura.csv.')
    expect(() => readLegacyZip(strToU8('não é um zip'))).toThrow(
      'Não foi possível abrir o arquivo.',
    )
    expect(() =>
      readLegacyZip(
        zip({
          'T_Usuarios.csv': 'Nome,Telefone\nAlguém,123\n',
          'T_Fatura.csv': INVOICES,
          'T_Consumo.csv': CONSUMPTION,
        }),
      ),
    ).toThrow(
      'T_Usuarios.csv não é do sistema antigo: faltam as colunas CodigoUsr, Usuario.',
    )
  })
})
