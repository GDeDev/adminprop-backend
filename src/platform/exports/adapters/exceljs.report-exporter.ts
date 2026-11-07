import ExcelJS from 'exceljs'

import {
  ExportCell,
  ExportColumn,
  ExportTable,
  ReportExporterPort,
} from '../report-exporter.port'

const MONEY_FORMAT = '#,##0.00;[Red]-#,##0.00'
/** Excel limita el nombre de la hoja a 31 caracteres y prohíbe algunos símbolos. */
const SHEET_NAME_FORBIDDEN = /[\\/?*[\]:]/g

/** Adapter `exceljs` (y CSV a mano) del `ReportExporterPort`. */
export class ExceljsReportExporter implements ReportExporterPort {
  async toXlsx(table: ExportTable): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    workbook.created = new Date()
    const sheet = workbook.addWorksheet(
      table.title.replace(SHEET_NAME_FORBIDDEN, ' ').slice(0, 31) || 'Reporte',
    )

    sheet.addRow([table.title]).font = { bold: true, size: 14 }
    for (const [label, value] of table.meta) {
      sheet.addRow([label, value]).getCell(1).font = { bold: true }
    }
    sheet.addRow([])

    const header = sheet.addRow(table.columns.map((column) => column.header))
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFC2410C' },
    }
    const headerRow = header.number

    for (const row of table.rows) {
      this.addDataRow(sheet, table.columns, row, false)
    }
    for (const row of table.totalRows ?? []) {
      this.addDataRow(sheet, table.columns, row, true)
    }

    table.columns.forEach((column, index) => {
      sheet.getColumn(index + 1).width = column.width ?? 18
    })
    sheet.views = [{ state: 'frozen', ySplit: headerRow }]

    return Buffer.from(await workbook.xlsx.writeBuffer())
  }

  toCsv(table: ExportTable): Buffer {
    const lines = [
      ...table.meta.map(([label, value]) => csvLine([label, value])),
      csvLine([]),
      csvLine(table.columns.map((column) => column.header)),
      ...table.rows.map(csvLine),
      ...(table.totalRows ?? []).map(csvLine),
    ]
    // BOM + `;`: es lo que abre bien el Excel en español sin asistente de importación.
    return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8')
  }

  private addDataRow(
    sheet: ExcelJS.Worksheet,
    columns: ExportColumn[],
    cells: ExportCell[],
    bold: boolean,
  ): void {
    const row = sheet.addRow(
      cells.map((cell, index) => excelValue(cell, columns[index])),
    )
    if (bold) row.font = { bold: true }
    columns.forEach((column, index) => {
      const cell = row.getCell(index + 1)
      if (column.kind === 'money') {
        cell.numFmt = MONEY_FORMAT
        cell.alignment = { horizontal: 'right' }
      } else if (column.kind === 'integer') {
        cell.alignment = { horizontal: 'right' }
      }
    })
  }
}

/**
 * Los montos viajan como string decimal por todo el sistema; la celda numérica
 * es el único lugar donde se convierten, para que Excel pueda sumarlos.
 */
function excelValue(
  cell: ExportCell,
  column: ExportColumn | undefined,
): string | number | null {
  if (cell === null || cell === '') return null
  if (
    (column?.kind === 'money' || column?.kind === 'integer') &&
    typeof cell === 'string' &&
    /^-?\d+(\.\d+)?$/.test(cell)
  ) {
    return Number(cell)
  }
  return cell
}

function csvLine(cells: ExportCell[]): string {
  return cells.map(csvCell).join(';')
}

function csvCell(cell: ExportCell): string {
  const text = cell === null ? '' : String(cell)
  // Un valor que empieza con = + @ (o con tab / retorno de carro, que Excel
  // ignora antes de evaluar) lo trataría como fórmula; los montos negativos
  // son números legítimos y se dejan pasar.
  const safe =
    /^[=+@\t\r]/.test(text) || /^-(?!\d)/.test(text) ? `'${text}` : text
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
