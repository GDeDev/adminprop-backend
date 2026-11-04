import ExcelJS from 'exceljs'

import { ExportTable } from '../report-exporter.port'
import { ExceljsReportExporter } from './exceljs.report-exporter'

const table: ExportTable = {
  title: 'Ingresos',
  meta: [['Generado', '2026-11-02']],
  columns: [
    { header: 'Mes' },
    { header: 'Moneda' },
    { header: 'Alquiler', kind: 'money' },
  ],
  rows: [
    ['2026-10', 'ARS', '100000.50'],
    ['2026-10', 'USD', '250.00'],
  ],
  totalRows: [['Total', 'ARS', '100000.50']],
}

describe('ExceljsReportExporter', () => {
  const exporter = new ExceljsReportExporter()

  it('escribe un XLSX con los montos como celdas numéricas', async () => {
    const buffer = await exporter.toXlsx(table)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as never)
    const sheet = workbook.getWorksheet('Ingresos')!
    expect(sheet.getRow(4).getCell(1).value).toBe('Mes')
    expect(sheet.getRow(5).getCell(3).value).toBe(100000.5)
    expect(sheet.getRow(7).getCell(1).value).toBe('Total')
  })

  it('escribe un CSV con BOM, punto y coma y comillas donde hace falta', () => {
    const csv = exporter
      .toCsv({
        ...table,
        rows: [
          ['a;b', 'say "hi"', '=SUM(A1)'],
          ['x', 'y', '-5.00'],
        ],
        totalRows: [],
      })
      .toString('utf8')
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('"a;b";"say ""hi""";\'=SUM(A1)')
    expect(csv).toContain('x;y;-5.00')
  })

  // Antes el prefijo sólo cubría = + @ -: un valor que arrancaba con tab o
  // retorno de carro se evaluaba como fórmula en Excel.
  it('neutraliza fórmulas que empiezan con tab o retorno de carro', () => {
    const csv = exporter
      .toCsv({
        ...table,
        rows: [['\t=1+1', '\r=1+1', 'normal']],
        totalRows: [],
      })
      .toString('utf8')
    expect(csv).toContain("'\t=1+1;")
    expect(csv).toContain('"\'\r=1+1"')
  })
})
