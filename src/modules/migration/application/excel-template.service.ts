import { Injectable } from '@nestjs/common'
import ExcelJS from 'exceljs'

import { Catalog, MasterDataFacade } from '@/modules/master-data/public'
import { LocationIndex } from '../domain/location-index'
import {
  ColumnDef,
  INSTRUCTIONS_SHEET,
  LIST_VALUES,
  LISTS_SHEET,
  MAX_ROWS_PER_FILE,
  META_SHEET,
  SHEETS,
  TEMPLATE_VERSION,
} from '../domain/template-definition'

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2937' },
}
const EXAMPLE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3F4F6' },
}

const INSTRUCTIONS = [
  'Cómo completar esta plantilla',
  '',
  '1. Completá una hoja por tipo de dato. No hace falta completarlas todas: las que dejes vacías se omiten.',
  '2. La primera fila de cada hoja son los encabezados (no los cambies ni los muevas) y la segunda es un ejemplo en gris: se ignora, podés dejarla o borrarla.',
  '3. Las columnas con asterisco en el encabezado de esta guía son obligatorias; las demás se pueden dejar vacías.',
  '4. Las hojas se enlazan por DNI/CUIT y por el Código de la propiedad, nunca por nombres: la hoja Propiedades usa el DNI del propietario, Inquilinos el DNI del garante y Contratos el Código de la propiedad y el DNI del inquilino.',
  '5. Fechas: dd/mm/aaaa. Montos: con o sin separador de miles, con coma o punto decimal (150.000 o 150000,50).',
  '6. Ubicación: escribí la ruta «Provincia > Ciudad > Barrio» (por ejemplo «Buenos Aires > CABA > Palermo»). Si no existe todavía, se crea al confirmar la importación.',
  '7. Tipo de propiedad y amenities que no existan en tu cuenta también se crean al confirmar. Los amenities van separados por coma.',
  '8. Si subís el mismo archivo dos veces no se duplica nada: lo ya importado se detecta. Lo que ya cargaste a mano nunca se pisa: se marca como conflicto para que decidas.',
  '9. Máximo 5.000 filas y 10 MB por archivo.',
  '',
  'Columnas por hoja (* obligatoria)',
]

/** Arma la plantilla del Excel con los maestros del tenant (rediseño 3.1). */
@Injectable()
export class ExcelTemplateService {
  constructor(private readonly masters: MasterDataFacade) {}

  async build(): Promise<Buffer> {
    const [nodes, types] = await Promise.all([
      this.masters.listLocationNodes(),
      this.masters.listCatalogItems(Catalog.PROPERTY_TYPES),
    ])
    const index = new LocationIndex(nodes)
    const locationPaths = nodes
      .filter((node) => node.level !== 'COUNTRY')
      .map((node) => index.pathOf(node.id).join(' > '))
      .sort((a, b) => a.localeCompare(b, 'es'))

    const values: Record<string, string[]> = {
      propertyTypes: types.map((t) => t.name).sort(),
      locations: locationPaths,
      ...LIST_VALUES,
    }
    const ranges = listRanges(values)

    // Las hojas se crean en el orden en que se ven.
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Adminprop'
    this.instructionsSheet(workbook)
    for (const sheet of SHEETS) {
      const worksheet = workbook.addWorksheet(sheet.name)
      sheet.columns.forEach((column, i) =>
        this.column(worksheet, column, i, ranges),
      )
      worksheet.views = [{ state: 'frozen', ySplit: 1 }]
    }
    this.listsSheet(workbook, values)
    const meta = workbook.addWorksheet(META_SHEET, { state: 'veryHidden' })
    meta.getCell('A1').value = 'template_version'
    meta.getCell('B1').value = TEMPLATE_VERSION

    return Buffer.from(await workbook.xlsx.writeBuffer())
  }

  private instructionsSheet(workbook: ExcelJS.Workbook): void {
    const sheet = workbook.addWorksheet(INSTRUCTIONS_SHEET)
    sheet.getColumn(1).width = 110
    sheet.getColumn(2).width = 60
    INSTRUCTIONS.forEach((line, i) => {
      const cell = sheet.getCell(i + 1, 1)
      cell.value = line
      cell.alignment = { wrapText: true, vertical: 'top' }
      if (i === 0) cell.font = { bold: true, size: 14 }
      if (i === INSTRUCTIONS.length - 1) cell.font = { bold: true }
    })
    let row = INSTRUCTIONS.length + 1
    for (const definition of SHEETS) {
      sheet.getCell(row, 1).value = `${definition.name}: ${definition.hint}`
      sheet.getCell(row, 1).font = { bold: true }
      sheet.getCell(row, 1).alignment = { wrapText: true, vertical: 'top' }
      row += 1
      sheet.getCell(row, 1).value = definition.columns
        .map((c) => (c.required ? `${c.header}*` : c.header))
        .join(' · ')
      sheet.getCell(row, 1).alignment = { wrapText: true, vertical: 'top' }
      row += 2
    }
  }

  /** Hoja oculta con los valores válidos que referencian los desplegables. */
  private listsSheet(
    workbook: ExcelJS.Workbook,
    values: Record<string, string[]>,
  ): void {
    const sheet = workbook.addWorksheet(LISTS_SHEET, { state: 'hidden' })
    Object.entries(values).forEach(([name, items], index) => {
      sheet.getCell(1, index + 1).value = name
      items.forEach((item, i) => {
        sheet.getCell(i + 2, index + 1).value = item
      })
    })
  }

  private column(
    worksheet: ExcelJS.Worksheet,
    column: ColumnDef,
    index: number,
    lists: Record<string, string | null>,
  ): void {
    const col = index + 1
    const header = worksheet.getCell(1, col)
    header.value = column.header
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = HEADER_FILL
    header.alignment = { vertical: 'middle', wrapText: true }
    worksheet.getColumn(col).width = column.width ?? 22

    const example = worksheet.getCell(2, col)
    example.value = column.example === '' ? null : column.example
    example.fill = EXAMPLE_FILL
    example.font = { italic: true, color: { argb: 'FF6B7280' } }

    const range = column.list ? lists[column.list] : null
    if (range) {
      // Tipos y ubicaciones admiten valores nuevos (se crean al confirmar).
      const open =
        column.list === 'propertyTypes' || column.list === 'locations'
      for (let row = 3; row <= MAX_ROWS_PER_FILE + 2; row += 1) {
        worksheet.getCell(row, col).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [range],
          showErrorMessage: !open,
          errorStyle: 'stop',
          errorTitle: 'Valor no válido',
          error: 'Elegí un valor de la lista.',
        }
      }
    }
  }
}

/** `Listas!$A$2:$A$9` de cada lista; null si la lista está vacía. */
function listRanges(
  values: Record<string, string[]>,
): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(values).map(([name, items], index) => {
      const letter = String.fromCharCode(65 + index)
      return [
        name,
        items.length > 0
          ? `${LISTS_SHEET}!$${letter}$2:$${letter}$${items.length + 1}`
          : null,
      ]
    }),
  )
}
