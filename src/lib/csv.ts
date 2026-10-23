/*
 * CSV that opens correctly in Excel/LibreOffice configured for Brazil:
 * semicolon separators, comma decimals and a UTF-8 BOM for the accents.
 */

type Cell = string | number | null | undefined

function escapeCell(value: Cell): string {
  const text = value == null ? '' : String(value)
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Cell[][]): string {
  return `﻿${rows.map((row) => row.map(escapeCell).join(';')).join('\r\n')}`
}

/** 123456 → "1234,56" (no thousands separator, so spreadsheets read a number). */
export function centsToCsv(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
