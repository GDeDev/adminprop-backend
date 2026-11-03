import ExcelJS from 'exceljs'

import { ImportEntity } from '../domain/migration.types'
import {
  MAX_ROWS_PER_FILE,
  META_SHEET,
  TEMPLATE_VERSION,
} from '../domain/template-definition'
import { ExcelReader, plainValue } from './excel-reader'

async function book(
  build: (workbook: ExcelJS.Workbook) => void,
  version: string | null = TEMPLATE_VERSION,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  if (version !== null) {
    const meta = workbook.addWorksheet(META_SHEET)
    meta.getCell('B1').value = version
  }
  build(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const OWNER_HEADERS = ['Nombre', 'Apellido', 'DNI/CUIT']

describe('ExcelReader', () => {
  const reader = new ExcelReader()

  it('lee las filas desde la 3 (la 2 es el ejemplo), por encabezado y sin importar el orden', async () => {
    const file = await book((workbook) => {
      const sheet = workbook.addWorksheet('Propietarios')
      sheet.addRow(['DNI/CUIT', 'Apellido', 'Nombre'])
      sheet.addRow(['99999999', 'Ejemplo', 'Ejemplo'])
      sheet.addRow([20111111, 'Pérez', 'Ana'])
      sheet.addRow([])
      sheet.addRow(['', '', ''])
      sheet.addRow([20222222, 'Díaz', 'Bruno'])
    })

    const parsed = await reader.read(file)

    const rows = parsed.sheets.get(ImportEntity.OWNER) ?? []
    expect(rows.map((r) => r.rowNumber)).toEqual([3, 6])
    expect(rows[0].cells).toMatchObject({
      firstName: 'Ana',
      lastName: 'Pérez',
      nationalId: 20111111,
    })
    expect(parsed.totalRows).toBe(2)
    expect(parsed.missingSheets).toEqual([
      'Garantes',
      'Inquilinos',
      'Propiedades',
      'Contratos',
    ])
  })

  it('rechaza lo que no es un zip, una versión distinta y un archivo sin hojas', async () => {
    await expect(reader.read(Buffer.from('hola'))).rejects.toMatchObject({
      code: 'INVALID_XLSX',
    })
    await expect(
      reader.read(await book(() => undefined, '0')),
    ).rejects.toMatchObject({ code: 'TEMPLATE_VERSION_MISMATCH' })
    await expect(
      reader.read(await book(() => undefined, null)),
    ).rejects.toMatchObject({ code: 'TEMPLATE_VERSION_MISMATCH' })
    await expect(
      reader.read(await book(() => undefined)),
    ).rejects.toMatchObject({ code: 'INVALID_XLSX' })
  })

  it('si falta una columna obligatoria avisa cuál', async () => {
    const file = await book((workbook) => {
      workbook.addWorksheet('Propietarios').addRow(['Nombre', 'Apellido'])
    })
    await expect(reader.read(file)).rejects.toThrow('DNI/CUIT')
  })

  it('corta a las 5.000 filas', async () => {
    const file = await book((workbook) => {
      const sheet = workbook.addWorksheet('Propietarios')
      sheet.addRow(OWNER_HEADERS)
      sheet.addRow(['ejemplo', 'ejemplo', 'ejemplo'])
      for (let i = 0; i <= MAX_ROWS_PER_FILE; i += 1) {
        sheet.addRow(['N', 'A', 20000000 + i])
      }
    })
    await expect(reader.read(file)).rejects.toMatchObject({
      code: 'IMPORT_TOO_MANY_ROWS',
    })
  })
})

describe('plainValue', () => {
  it('desarma texto enriquecido, fórmulas e hipervínculos', () => {
    expect(plainValue({ richText: [{ text: 'a' }, { text: 'b' }] })).toBe('ab')
    expect(plainValue({ formula: '1+1', result: 2 })).toBe(2)
    expect(plainValue({ text: 'x', hyperlink: 'http://x' })).toBe('x')
    expect(plainValue(null)).toBeNull()
  })
})
