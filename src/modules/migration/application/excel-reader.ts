import { Injectable } from '@nestjs/common'
import ExcelJS from 'exceljs'

import { CellValue, normalizeText } from '../domain/import-normalizers'
import {
  InvalidXlsxException,
  TemplateVersionMismatchException,
  TooManyRowsException,
} from '../domain/migration.exceptions'
import { ImportEntity } from '../domain/migration.types'
import { SheetRow } from '../domain/row-validators'
import { assertSafeZip } from '../domain/zip-guard'
import {
  MAX_FILE_BYTES,
  MAX_ROWS_PER_FILE,
  META_SHEET,
  SHEETS,
  TEMPLATE_VERSION,
} from '../domain/template-definition'

export interface ParsedWorkbook {
  sheets: Map<ImportEntity, SheetRow[]>
  /** Hojas de la plantilla que el archivo no trae. */
  missingSheets: string[]
  totalRows: number
}

/** Los .xlsx son zips: empiezan con `PK`. */
const ZIP_SIGNATURE = [0x50, 0x4b]

/** Convierte lo que devuelve exceljs en un valor simple de celda. */
export function plainValue(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  ) {
    return value
  }
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('')
    if ('result' in value) return plainValue(value.result as ExcelJS.CellValue)
    if ('text' in value) return String(value.text)
    if ('error' in value) return null
  }
  return null
}

/** Lee el .xlsx subido con la plantilla de Adminprop (rediseño 3). */
@Injectable()
export class ExcelReader {
  async read(buffer: Buffer): Promise<ParsedWorkbook> {
    if (
      buffer.length > MAX_FILE_BYTES ||
      buffer.length < 4 ||
      buffer[0] !== ZIP_SIGNATURE[0] ||
      buffer[1] !== ZIP_SIGNATURE[1]
    ) {
      throw new InvalidXlsxException(
        'El archivo no es un Excel (.xlsx) válido o pesa más de 10 MB',
      )
    }

    // Antes de inflar nada en memoria (zip bombs).
    assertSafeZip(buffer)

    const workbook = new ExcelJS.Workbook()
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
    } catch {
      throw new InvalidXlsxException(
        'No se pudo leer el archivo: tiene que ser un Excel (.xlsx) sin contraseña',
      )
    }

    const found = workbook.getWorksheet(META_SHEET)?.getCell('B1').value
    const version = found === null || found === undefined ? null : String(found)
    if (version !== TEMPLATE_VERSION) {
      throw new TemplateVersionMismatchException(version, TEMPLATE_VERSION)
    }

    const sheets = new Map<ImportEntity, SheetRow[]>()
    const missingSheets: string[] = []
    let totalRows = 0

    for (const definition of SHEETS) {
      const worksheet = workbook.getWorksheet(definition.name)
      if (!worksheet) {
        missingSheets.push(definition.name)
        continue
      }

      // Columna de cada campo, por el texto del encabezado (el orden no importa).
      const byHeader = new Map<string, number>()
      worksheet.getRow(1).eachCell((cell, col) => {
        const text = plainValue(cell.value)
        if (text !== null) byHeader.set(normalizeText(String(text)), col)
      })
      const columns = definition.columns.map((column) => ({
        key: column.key,
        col: byHeader.get(normalizeText(column.header)),
        header: column.header,
        required: column.required,
      }))
      const missing = columns.filter((c) => c.required && c.col === undefined)
      if (missing.length > 0) {
        throw new InvalidXlsxException(
          `A la hoja «${definition.name}» le falta la columna «${missing[0].header}»: usá la plantilla sin cambiar los encabezados`,
        )
      }

      const rows: SheetRow[] = []
      // Sólo las filas que existen: con `rowCount` una celda suelta en la fila
      // 1.048.576 obligaba a recorrer (y crear) un millón de filas vacías.
      // La fila 2 es el ejemplo de la plantilla: se ignora.
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber < 3) return
        const cells: Record<string, CellValue> = {}
        let hasData = false
        for (const column of columns) {
          if (column.col === undefined) continue
          const value = plainValue(row.getCell(column.col).value)
          cells[column.key] = value
          if (value !== null && String(value).trim() !== '') hasData = true
        }
        if (!hasData) return
        rows.push({ rowNumber, cells })
        totalRows += 1
        if (totalRows > MAX_ROWS_PER_FILE) {
          throw new TooManyRowsException(MAX_ROWS_PER_FILE)
        }
      })
      sheets.set(definition.entity, rows)
    }

    if (missingSheets.length === SHEETS.length) {
      throw new InvalidXlsxException(
        'El archivo no tiene ninguna hoja de la plantilla',
      )
    }
    return { sheets, missingSheets, totalRows }
  }
}
