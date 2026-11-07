import { deflateRawSync } from 'node:zlib'

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

/**
 * Un zip de una sola entrada deflatada, armado a mano para poder falsear el
 * tamaño descomprimido que declara (así las zip bombs reales engañan a quien
 * sólo mira los encabezados).
 */
function zipOf(content: Buffer, declaredSize = content.length): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml')
  const data = deflateRawSync(content)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(declaredSize, 22)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(declaredSize, 24)
  central.writeUInt16LE(name.length, 28)
  const centralOffset = local.length + name.length + data.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + name.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([local, name, data, central, name, end])
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
  // Qué fallaba: el tope de 10 MB era del archivo comprimido y exceljs inflaba
  // todo en memoria; un .xlsx chico podía ser una zip bomb.
  it('rechaza una zip bomb, aunque el encabezado declare un tamaño chico', async () => {
    const bomb = Buffer.alloc(60 * 1024 * 1024)
    for (const declared of [bomb.length, 100]) {
      const file = zipOf(bomb, declared)
      expect(file.length).toBeLessThan(1024 * 1024)
      await expect(reader.read(file)).rejects.toMatchObject({
        code: 'INVALID_XLSX',
        message: expect.stringContaining('descomprimido'),
      })
    }
  })

  it('rechaza un zip con la estructura rota o con entradas en zip64', async () => {
    const good = zipOf(Buffer.from('<sheet/>'))
    const truncated = good.subarray(0, good.length - 30)
    await expect(reader.read(truncated)).rejects.toMatchObject({
      code: 'INVALID_XLSX',
    })
    const zip64 = Buffer.from(good)
    zip64.writeUInt32LE(0xffffffff, zip64.length - 22 + 16)
    await expect(reader.read(zip64)).rejects.toMatchObject({
      code: 'INVALID_XLSX',
    })
  })

  // Qué fallaba: se recorría `rowCount` con getRow(), que crea cada fila vacía:
  // una celda suelta en la fila 1.048.576 costaba un millón de iteraciones.
  it('una celda suelta en una fila altísima no cuesta recorrer las filas vacías', async () => {
    const file = await book((workbook) => {
      const sheet = workbook.addWorksheet('Propietarios')
      sheet.addRow(OWNER_HEADERS)
      sheet.addRow(['ejemplo', 'ejemplo', 'ejemplo'])
      sheet.addRow(['Ana', 'Pérez', 20111111])
      sheet.getCell(1_048_576, 1).value = 'perdida'
    })
    const started = Date.now()

    const parsed = await reader.read(file)

    const rows = parsed.sheets.get(ImportEntity.OWNER) ?? []
    expect(rows.map((r) => r.rowNumber)).toEqual([3, 1_048_576])
    expect(Date.now() - started).toBeLessThan(3000)
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
