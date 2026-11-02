import { strFromU8, unzipSync } from 'fflate'
import { UserFacingError } from '#/lib/errors'

/*
 * Just enough of the Excel format (.xlsx) to read a sheet typed by hand:
 * texts, numbers and the results of formulas, cell by cell. An .xlsx is a
 * .zip of XML files: the workbook lists the sheets, and the texts of all
 * sheets are kept together in sharedStrings.xml.
 */

export type CellValue = string | number

export interface Cell {
  /** 0-based: A1 is row 0, column 0. */
  row: number
  col: number
  value: CellValue
}

export interface Sheet {
  name: string
  cells: Cell[]
}

/** A sheet typed by hand has a few KB; don't unpack more than this. */
const MAX_PART_BYTES = 10 * 1024 * 1024

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? Number.parseInt(name.slice(2), 16)
          : Number(name.slice(1))
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity
    }
    return ENTITIES[name] ?? entity
  })
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [, name = '', value = ''] of tag.matchAll(/([\w:]+)="([^"]*)"/g)) {
    result[name] = decode(value)
  }
  return result
}

/** The text of a string item: plain, or in runs of rich text. */
function textOf(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map(([, text = '']) => decode(text))
    .join('')
}

/** "B3" → row 2, column 1. */
function position(reference: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(reference)
  if (!match) return null
  let col = 0
  for (const letter of match[1] ?? '') {
    col = col * 26 + letter.charCodeAt(0) - 64
  }
  return { row: Number(match[2]) - 1, col: col - 1 }
}

function cellsOf(xml: string, strings: string[]): Cell[] {
  const data = /<sheetData[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? ''
  const cells: Cell[] = []
  for (const [, tag = '', inner = ''] of data.matchAll(
    /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
  )) {
    const { r, t } = attributes(tag)
    const at = r ? position(r) : null
    if (!at) continue
    const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
    let value: CellValue | undefined
    if (t === 's') {
      value = strings[Number(raw)]
    } else if (t === 'inlineStr') {
      value = textOf(inner)
    } else if (t === 'str' || t === 'd') {
      // A formula's text, or a date written as text.
      value = raw === undefined ? '' : decode(raw)
    } else if ((t === undefined || t === 'n') && raw !== undefined) {
      const number = Number(raw)
      if (Number.isFinite(number)) value = number
    }
    if (value !== undefined && value !== '') cells.push({ ...at, value })
  }
  return cells
}

/**
 * The sheets of an .xlsx, in the workbook's order, or null when the file
 * is a .zip but not a spreadsheet.
 */
export function readXlsx(bytes: Uint8Array): Sheet[] | null {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: ({ name, originalSize }) =>
        name.startsWith('xl/') &&
        /\.(xml|rels)$/.test(name) &&
        originalSize <= MAX_PART_BYTES,
    })
  } catch {
    return null
  }
  const read = (name: string) => {
    const file = files[name]
    return file ? strFromU8(file) : null
  }
  const workbook = read('xl/workbook.xml')
  if (workbook === null) return null

  const strings = [
    ...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map(([, item = '']) => textOf(item))
  const targets = new Map(
    [
      ...(read('xl/_rels/workbook.xml.rels') ?? '').matchAll(
        /<Relationship\b[^>]*>/g,
      ),
    ].map(([tag]) => {
      const { Id, Target } = attributes(tag)
      return [Id, Target] as const
    }),
  )
  const sheets: Sheet[] = []
  for (const [tag] of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const sheet = attributes(tag)
    const target = targets.get(sheet['r:id'] ?? '')
    if (!target) continue
    // Relative to xl/ (or absolute, from the root of the .zip).
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const xml = read(path)
    if (xml === null) continue
    sheets.push({ name: sheet.name ?? '', cells: cellsOf(xml, strings) })
  }
  if (sheets.length === 0) {
    throw new UserFacingError(
      'Não foi possível ler a planilha. Salve-a de novo no Excel (.xlsx) e tente outra vez.',
    )
  }
  return sheets
}
