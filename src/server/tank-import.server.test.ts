import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { openDatabase } from '#/db/client.server'
import { listTankReadings, saveTankReading } from './tank.server'
import { importTankSheet, readTankSheet } from './tank-import.server'

const TODAY = '2026-11-02'

type Value = string | number

/**
 * A minimal .xlsx, as Excel saves it: texts in sharedStrings.xml, numbers
 * in the cells. `rows` start at A1. Fictitious readings only.
 */
function xlsx(rows: Value[][], options: { inline?: boolean } = {}) {
  const strings: string[] = []
  const cell = (value: Value, ref: string) => {
    if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`
    if (options.inline) {
      return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
    }
    strings.push(value)
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`
  }
  const sheet = rows
    .map(
      (row, index) =>
        `<row r="${index + 1}">${row
          .map((value, col) =>
            value === '' ? '' : cell(value, `${'ABCDEFGHIJ'[col]}${index + 1}`),
          )
          .join('')}</row>`,
    )
    .join('')
  return zipSync({
    'xl/workbook.xml': strToU8(
      '<workbook><sheets><sheet name="Plan1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet><sheetData>${sheet}</sheetData></worksheet>`,
    ),
    'xl/sharedStrings.xml': strToU8(
      `<sst>${strings.map((text) => `<si><t>${text}</t></si>`).join('')}</sst>`,
    ),
  })
}

/** Dates in a row and readings below them, with what Excel worked out. */
const ACROSS = xlsx([
  ['Consumo'],
  ['Data', '12/03/2021', '20/07/2021', '05/01/2022'],
  ['Leitura (m3)', 100.5, 1250.75, 2418.655],
  ['Consumo', 100.5, 1150.25, 1167.905],
])

describe('reading a spreadsheet of the caixa d’água', () => {
  test('a "Data" row and a "Leitura" row', () => {
    expect(readTankSheet(ACROSS)).toEqual({
      sheet: 'Plan1',
      readings: [
        { date: '2021-03-12', liters: 100_500 },
        { date: '2021-07-20', liters: 1_250_750 },
        { date: '2022-01-05', liters: 2_418_655 },
      ],
      unreadable: [],
    })
  })

  test('or the two columns, with Excel dates and texts', () => {
    // 45292 is 01/01/2024 for Excel.
    const sheet = xlsx(
      [
        ['Data da leitura', 'Leitura'],
        [45292, '1.500,25'],
        ['15/02/24', 1600],
        ['', 1700],
        ['31/02/2024', 1800],
        ['10/03/2024', 'muito'],
      ],
      { inline: true },
    )
    expect(readTankSheet(sheet)).toEqual({
      sheet: 'Plan1',
      readings: [
        { date: '2024-01-01', liters: 1_500_250 },
        { date: '2024-02-15', liters: 1_600_000 },
      ],
      unreadable: [
        'Linha 4: leitura sem data',
        'Linha 5: a data “31/02/2024” não foi entendida',
        'Linha 6: a leitura “muito” não foi entendida',
      ],
    })
  })

  test('a .zip that is not a spreadsheet is left to the other imports', () => {
    const legacy = readFileSync(
      path.join(import.meta.dir, 'fixtures/legacy-access.zip'),
    )
    expect(readTankSheet(new Uint8Array(legacy))).toBeNull()
    expect(() => readTankSheet(xlsx([['Nome', 'Telefone']]))).toThrow(
      'A planilha precisa de uma linha (ou coluna) “Data” e outra “Leitura”',
    )
  })
})

describe('importing the readings', () => {
  test('only the days the app lacks, when they fit', () => {
    const db = openDatabase(':memory:')
    // Typed in the app: one on a day of the spreadsheet, and one higher
    // than the spreadsheet's reading eleven days later.
    saveTankReading(db, { date: '2021-07-20', liters: 1_251_000 }, TODAY)
    saveTankReading(db, { date: '2021-03-01', liters: 200_000 }, TODAY)

    const sheet = readTankSheet(ACROSS)
    if (!sheet) throw new Error('A planilha de teste é um .xlsx.')
    expect(importTankSheet(db, sheet, TODAY)).toEqual({
      added: 1,
      existing: 1,
      skipped: [
        'Leitura de 12/03/2021 (100,5 m³): é menor que a de 01/03/2021 (200 m³); não foi importada (se o hidrômetro foi trocado, lance-a na tela Caixa d’água)',
      ],
    })
    expect(
      listTankReadings(db).map(({ date, liters }) => [date, liters]),
    ).toEqual([
      ['2021-03-01', 200_000],
      ['2021-07-20', 1_251_000],
      ['2022-01-05', 2_418_655],
    ])
    // The same spreadsheet again adds nothing.
    expect(importTankSheet(db, sheet, TODAY)).toMatchObject({
      added: 0,
      existing: 2,
    })
  })

  test('readings in the wrong order are reported, not guessed', () => {
    const db = openDatabase(':memory:')
    const sheet = readTankSheet(
      xlsx([
        [
          'Data',
          '10/01/2025',
          '10/02/2025',
          '10/02/2025',
          '10/03/2025',
          '10/12/2026',
        ],
        ['Leitura', 500, 450, 520, 600, 700],
      ]),
    )
    if (!sheet) throw new Error('A planilha de teste é um .xlsx.')
    expect(importTankSheet(db, sheet, TODAY)).toEqual({
      added: 2,
      existing: 0,
      skipped: [
        'Leitura de 10/02/2025 (450 m³): é menor que a de 10/01/2025 (500 m³); não foi importada (se o hidrômetro foi trocado, lance-a na tela Caixa d’água)',
        'Leitura de 10/02/2025 (520 m³): a planilha tem outra leitura nesse dia; ficou a primeira',
        'Leitura de 10/12/2026 (700 m³): a data é depois de hoje; não foi importada',
      ],
    })
  })
})
