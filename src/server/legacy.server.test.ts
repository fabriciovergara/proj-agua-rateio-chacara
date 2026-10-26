import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { openDatabase } from '#/db/client.server'
import { appPassword, owners, periods, properties, readings } from '#/db/schema'
import { setAppPassword } from './auth.server'
import {
  describeLegacyImport,
  importLegacy,
  isAccessFile,
  legacyEnergyCents,
  legacyMoneyToCents,
  legacyPriceToMicros,
  legacyPropertyName,
  parseLegacyCsv,
  parseLegacyDate,
  parseLegacyPeriod,
  readLegacyExport,
  readLegacyMdb,
  readLegacyPath,
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

  // From late 2009 the old app's users typed the dates.
  test.each([
    ['10/10/09 a 08/02/10', range('2009-10-10', '2010-02-08')],
    ['05/4/12 a 02/6/12', range('2012-04-05', '2012-06-02')],
    ['30/09/10 a 31/12/2010', range('2010-09-30', '2010-12-31')],
    ['26/07/11 A 14/09/11', range('2011-07-26', '2011-09-14')],
    ['6/8/15a25/10/15', range('2015-08-06', '2015-10-25')],
    ['10/10/09 / 08/02/10', range('2009-10-10', '2010-02-08')],
    ['19/4/22 aa 05/9/22', range('2022-04-19', '2022-09-05')],
    ['10 Abr 09 / 10/10/09', range('2009-04-10', '2009-10-10')],
    ['01 Dez 10 a 31/12/10', range('2010-12-01', '2010-12-31')],
    ['10 Out 09 a 08 02 10', range('2009-10-10', '2010-02-08')],
  ])('%p → %p', (mes, expected) => {
    expect(parseLegacyPeriod(mes, null)).toEqual(expected)
  })

  test.each([
    // Slashes doubled, typed as a digit or left out; stray characters.
    ['18//7/17 a 13/1/18', range('2017-07-18', '2018-01-13')],
    ['28/5/25 a  17/9*/25', range('2025-05-28', '2025-09-17')],
    ['10/04021 a 12/12/21', range('2021-04-10', '2021-12-12')],
    ['06/922 a 22/3/2023', range('2022-09-06', '2023-03-22')],
    ['19/4/22 a 05/92022', range('2022-04-19', '2022-09-05')],
    ['05/04/12 a 02/6/1210/06/2012', range('2012-04-05', '2012-06-02')],
    // A year with a digit missing or too many comes from the other date.
    ['01/02/11 a 02/03/1', range('2011-02-01', '2011-03-02')],
    ['28/5/25 a 17/9/2525', range('2025-05-28', '2025-09-17')],
  ])('typo %p → %p', (mes, expected) => {
    expect(parseLegacyPeriod(mes, null)).toEqual(expected)
  })

  test('of two years that disagree, the typo is the one far from the day the row was entered', () => {
    expect(parseLegacyPeriod('21/7/14 a 21/10/47', null, '2014-10-21')).toEqual(
      range('2014-07-21', '2014-10-21'),
    )
    expect(
      parseLegacyPeriod('08 Fev 19 a 30 Set 10', null, '2010-09-30'),
    ).toEqual(range('2010-02-08', '2010-09-30'))
    expect(parseLegacyPeriod('06/9/22 a 22/03/22', null, '2023-03-22')).toEqual(
      range('2022-09-06', '2023-03-22'),
    )
  })

  test('words are not dates', () => {
    // "pago" has "ago" in it, but no August.
    expect(parseLegacyPeriod('pago até Dez.2010', null)).toEqual(
      range('2010-11-10', '2010-12-10'),
    )
    expect(parseLegacyPeriod('xxxxxxxxxxxxxxxxx', 2025)).toBeNull()
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
    // Longer numbers are phones or CEPs.
    expect(legacyPropertyName('28) Recanto Fictício 30000000', 'Rosa')).toBe(
      'Chácara 28',
    )
    expect(legacyPropertyName('Chácara  (30000001)', 'Teodoro')).toBe(
      'Chácara Teodoro',
    )
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

/*
 * Access databases made with Jackcess (Java) for these tests, as fictitious
 * as the CSVs: Rateio.mdb has their rows; "Rateio antigo.mdb", an older
 * copy, only registros 10 and 12, unpaid; Outro.mdb is not the old app's.
 */
const ACCESS = unzipSync(
  readFileSync(path.join(import.meta.dir, 'fixtures/legacy-access.zip')),
)
const accessFile = (name: string) => {
  const file = ACCESS[name]
  if (!file) throw new Error(`No fixture ${name}`)
  return file
}

/** Three chácaras and the rows of T_Cosumo given. */
const threeChacaras = (consumption: string) => ({
  users:
    parseLegacyCsv(`CodigoUsr,Usuario,CPF,Endereco,Telefone,Celular,Hidrometro,Observacoes
1,"Zuleica Fictícia",,"Chácara 7",,,"H-0007",
2,"Quirino Exemplo",,"(9)",,,"H-0009",
3,"Teodoro Exemplo",,"(11)",,,"H-0011",
`),
  invoices: parseLegacyCsv('NumeroFatura,CodigoUsr\n1,1\n2,2\n3,3\n'),
  consumption: parseLegacyCsv(
    `CodigoCosumo,NumeroFatura,LeituraAtual,LeituraAnterior,Valor,Fundo,Mes,Data,Vencimento,Quitado,Ano\n${consumption}`,
  ),
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
        bill: 700 + 170,
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
        // Registro 15, typed again after registro 12.
        propertyId: 2,
        periodId: 1,
        previous: 60,
        current: 65,
        energy: 170,
        fund: 1000,
        paid: false,
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

  test('readings a few days apart are one round; a month apart, two', () => {
    const db = openDatabase(':memory:')
    const rounds =
      threeChacaras(`30,1,110,100,0.35,15,"31/10/10 a 01/12/10","12/02/10 00:00:00",,1,"2010"
31,2,45,40,0.35,15,"31/10/10 a 01/12/10","12/02/10 00:00:00",,1,"2010"
32,3,210,200,0.35,15,"31/10/10 a 03/12/10","12/03/10 00:00:00",,1,"2010"
33,1,130,110,0.35,15,"01/12/10 a 31/12/10","01/03/11 00:00:00",,1,"2010"
34,2,50,45,0.35,15,"01/12/10 a 31/12/10","01/03/11 00:00:00",,1,"2010"
35,3,230,210,0.35,15,"03/12/10 a 31/12/2010","01/03/11 00:00:00",,1,"2010"
`)
    expect(importLegacy(db, rounds)).toMatchObject({ readings: 6, skipped: [] })

    expect(
      db
        .select({ startDate: periods.startDate, endDate: periods.endDate })
        .from(periods)
        .orderBy(asc(periods.startDate))
        .all(),
    ).toEqual([
      { startDate: '2010-10-31', endDate: '2010-12-01' },
      { startDate: '2010-12-01', endDate: '2010-12-31' },
    ])
    // Chácara 11 was read two days later.
    expect(
      getPropertySheet(db, 3)?.readings.map(({ startDate, endDate }) => ({
        startDate,
        endDate,
      })),
    ).toEqual([
      { startDate: '2010-10-31', endDate: '2010-12-03' },
      { startDate: '2010-12-03', endDate: '2010-12-31' },
    ])
    // Each round finds its period again.
    expect(importLegacy(db, rounds)).toMatchObject({
      readings: 0,
      existing: 6,
      skipped: [],
    })
  })

  test('a chácara read again is in the next round, even with late readings in between', () => {
    const db = openDatabase(':memory:')
    const rounds =
      threeChacaras(`50,1,110,100,0.35,15,"01/11/10 a 01/12/10",,,1,"2010"
51,2,45,40,0.35,15,"01/11/10 a 01/12/10",,,1,"2010"
52,3,210,200,0.35,15,"01/11/10 a 12/12/10",,,1,"2010"
53,1,130,110,0.35,15,"01/12/10 a 24/12/10",,,1,"2010"
54,2,50,45,0.35,15,"01/12/10 a 24/12/10",,,1,"2010"
55,3,230,210,0.35,15,"12/12/10 a 06/01/11",,,1,"2011"
`)

    expect(importLegacy(db, rounds)).toMatchObject({ readings: 6, skipped: [] })
    expect(
      db
        .select({ startDate: periods.startDate, endDate: periods.endDate })
        .from(periods)
        .orderBy(asc(periods.startDate))
        .all(),
    ).toEqual([
      { startDate: '2010-11-01', endDate: '2010-12-01' },
      { startDate: '2010-12-01', endDate: '2010-12-24' },
    ])
  })

  test('a row typed again replaces the one before it', () => {
    const db = openDatabase(':memory:')
    const result = importLegacy(
      db,
      threeChacaras(`41,1,125,100,0.35,10,"10/01/07 a 10/02/07","02/20/07 00:00:00",,1,"2007"
40,1,120,100,0.35,10,"10/01/07 a 10/02/07","02/15/07 00:00:00",,0,"2007"
`),
    )

    expect(result.skipped).toEqual([
      'registro 40: Chácara 7 tem outra leitura no período de 10/01/2007 a 10/02/2007 (entrou a mais recente, registro 41)',
    ])
    expect(
      db
        .select({ current: readings.currentReading, paid: readings.paid })
        .from(readings)
        .all(),
    ).toEqual([{ current: 125, paid: true }])
  })

  test('an old user registered again with the same meter is the same chácara', () => {
    const db = openDatabase(':memory:')
    const result = importLegacy(db, {
      users:
        parseLegacyCsv(`CodigoUsr,Usuario,CPF,Endereco,Telefone,Celular,Hidrometro,Observacoes
5,"Zuleica Fictícia",,"Chácara",,,"H-0007",
1,"Zuleica Fictícia",,"Chácara 7",,"(11) 90000-0001","H-0007",
2,"Quirino Exemplo",,"(9)",,,"H-0009",
`),
      invoices: parseLegacyCsv('NumeroFatura,CodigoUsr\n1,1\n2,2\n4,5\n'),
      consumption: parseLegacyCsv(CONSUMPTION.replace('\n11,1,', '\n11,4,')),
    })

    expect(result).toMatchObject({ created: 2, matched: 0, readings: 3 })
    // The first code made it.
    expect(
      db
        .select({ name: properties.name, notes: owners.notes })
        .from(properties)
        .innerJoin(owners, eq(owners.id, properties.ownerId))
        .orderBy(asc(properties.id))
        .all(),
    ).toEqual([
      {
        name: 'Chácara 7',
        notes: 'Importado do sistema antigo (código 1).',
      },
      {
        name: 'Chácara 9',
        notes: 'Importado do sistema antigo (código 2).',
      },
    ])
    // March came with the code it was registered again with.
    expect(getPropertySheet(db, 1)?.readings).toHaveLength(2)
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
        '  - registro 16: fatura 3 sem usuário',
        '  - registro 12: Chácara 9 tem outra leitura no período de 10/01/2007 a 10/02/2007 (entrou a mais recente, registro 15)',
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

describe('readLegacyExport', () => {
  let folder: string | undefined

  function writeExport(files: Record<string, string | Uint8Array>) {
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

  test('reads the three CSVs of a folder', () => {
    const dir = writeExport({
      'T_Usuarios.csv': USERS,
      'T_Fatura.csv': INVOICES,
      'T_Consumo.csv': CONSUMPTION,
    })

    expect(readLegacyExport(dir)).toEqual(legacyExport())
  })

  test('names the missing file', () => {
    const dir = writeExport({
      'T_Usuarios.csv': USERS,
      'T_Fatura.csv': INVOICES,
    })

    expect(() => readLegacyExport(dir)).toThrow(
      `Arquivo não encontrado: ${path.join(dir, 'T_Consumo.csv')}`,
    )
  })

  test('the script takes the folder, the .mdb or the .zip', () => {
    const dir = writeExport({
      'T_Usuarios.csv': USERS,
      'T_Fatura.csv': INVOICES,
      'T_Consumo.csv': CONSUMPTION,
      'Rateio.mdb': accessFile('Rateio.mdb'),
      'Rateio.zip': zipSync({ 'Rateio.mdb': accessFile('Rateio.mdb') }),
    })

    expect(readLegacyPath(dir)).toEqual(legacyExport())
    expect(readLegacyPath(path.join(dir, 'Rateio.mdb'))).toEqual(legacyExport())
    expect(readLegacyPath(path.join(dir, 'Rateio.zip'))).toEqual(legacyExport())
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

  test('a round goes to the period of the app ending closest to it', () => {
    const db = openDatabase(':memory:')
    db.insert(periods)
      .values([
        { startDate: '2010-11-01', endDate: '2010-12-01', reserveFundCents: 0 },
        { startDate: '2010-12-01', endDate: '2010-12-10', reserveFundCents: 0 },
      ])
      .run()

    const result = importLegacy(
      db,
      threeChacaras(`60,1,110,100,0.35,15,"01/12/10 a 08/12/10",,,1,"2010"
61,2,45,40,0.35,15,"01/12/10 a 08/12/10",,,1,"2010"
`),
    )

    expect(result).toMatchObject({ readings: 2, skipped: [] })
    expect(
      db
        .select({ endDate: periods.endDate })
        .from(readings)
        .innerJoin(periods, eq(periods.id, readings.periodId))
        .all(),
    ).toEqual([{ endDate: '2010-12-10' }, { endDate: '2010-12-10' }])
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

describe('readLegacyMdb', () => {
  test('reads the tables as mdb-export writes them in the CSVs', () => {
    const mdb = accessFile('Rateio.mdb')

    expect(isAccessFile(mdb)).toBe(true)
    expect(readLegacyMdb(mdb)).toEqual(legacyExport())
  })

  test('says what is wrong with the file', () => {
    expect(isAccessFile(strToU8('não é um mdb'))).toBe(false)
    expect(() => readLegacyMdb(accessFile('Outro.mdb'), 'Outro.mdb')).toThrow(
      'Outro.mdb não tem a tabela T_Usuarios do sistema antigo.',
    )
    expect(() =>
      readLegacyMdb(accessFile('Rateio.mdb').subarray(0, 4096)),
    ).toThrow('Não foi possível ler o arquivo do Access.')
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

  test('takes the Access database with the most recent readings', () => {
    const data = readLegacyZip(
      zip({
        'Agua/Rateio antigo.mdb': accessFile('Rateio antigo.mdb'),
        'Agua/Rateio.mdb': accessFile('Rateio.mdb'),
        'Agua/Rateio.ldb': 'ESCRITORIO  Admin',
        'Agua/Outro.mdb': accessFile('Outro.mdb'),
        '__MACOSX/Agua/._Rateio.mdb': new Uint8Array([0, 5, 22, 7]),
      }),
    )

    expect(data).toEqual({
      ...legacyExport(),
      database: 'Rateio.mdb',
      olderCopies: ['Rateio antigo.mdb'],
    })
  })

  test('a single Access database, or the CSVs when the .zip has them', () => {
    expect(
      readLegacyZip(zip({ 'Rateio.mdb': accessFile('Rateio.mdb') })),
    ).toEqual(legacyExport())
    expect(
      readLegacyZip(
        zip({
          'T_Usuarios.csv': USERS,
          'T_Fatura.csv': INVOICES,
          'T_Consumo.csv': CONSUMPTION,
          'Rateio antigo.mdb': accessFile('Rateio antigo.mdb'),
        }),
      ),
    ).toEqual(legacyExport())
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
    expect(() =>
      readLegacyZip(zip({ 'Outro.mdb': accessFile('Outro.mdb') })),
    ).toThrow('Outro.mdb não tem a tabela T_Usuarios do sistema antigo.')
    expect(() => readLegacyZip(zip({ 'leia-me.txt': 'Nada aqui.' }))).toThrow(
      'O .zip não tem os dados do sistema antigo',
    )
  })
})
