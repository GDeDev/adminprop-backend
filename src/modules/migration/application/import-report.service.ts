import { Injectable } from '@nestjs/common'
import ExcelJS from 'exceljs'

import { PropertiesFacade } from '@/modules/properties/public'
import {
  ImportAssetRepository,
  ImportRowRepository,
} from '../domain/migration.ports'
import { ImportBatch, ImportRowStatus } from '../domain/migration.types'
import { sheetOf } from '../domain/template-definition'

const STATUS_LABELS: Record<ImportRowStatus, string> = {
  [ImportRowStatus.VALID]: 'Lista para importar',
  [ImportRowStatus.ERROR]: 'Con errores',
  [ImportRowStatus.CONFLICT]: 'En conflicto',
  [ImportRowStatus.ALREADY_IMPORTED]: 'Ya importada',
  [ImportRowStatus.IMPORTED]: 'Importada',
  [ImportRowStatus.SKIPPED]: 'Omitida',
  [ImportRowStatus.FAILED]: 'Falló al importar',
}

/** Estados que el usuario tiene que mirar para corregir y volver a subir. */
const REPORTED = new Set([
  ImportRowStatus.ERROR,
  ImportRowStatus.CONFLICT,
  ImportRowStatus.FAILED,
])

/**
 * Neutraliza una celda que Excel leería como fórmula (D-199). El reporte copia
 * texto del archivo que subió el usuario (identificaciones, mensajes con el
 * valor): una celda `=HYPERLINK(...)` se ejecutaría al abrirlo. El apóstrofo
 * previo la fuerza a texto.
 */
const FORMULA_START = /^[=+\-@\t\r]/

export function neutralizeFormula<T>(value: T): T | string {
  return typeof value === 'string' && FORMULA_START.test(value)
    ? `'${value}`
    : value
}

function addSafeRow(sheet: ExcelJS.Worksheet, values: unknown[]): void {
  sheet.addRow(values.map(neutralizeFormula))
}

/** El reporte `.xlsx` del lote: errores y conflictos por fila, y las fotos por propiedad. */
@Injectable()
export class ImportReportService {
  constructor(
    private readonly rows: ImportRowRepository,
    private readonly assets: ImportAssetRepository,
    private readonly properties: PropertiesFacade,
  ) {}

  async build(batch: ImportBatch): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Adminprop'

    const sheet = workbook.addWorksheet('Errores y conflictos')
    addSafeRow(sheet, [
      'Hoja',
      'Fila',
      'Identificación',
      'Estado',
      'Campo',
      'Código',
      'Mensaje',
    ])
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    ;[18, 8, 34, 20, 22, 26, 80].forEach((width, i) => {
      sheet.getColumn(i + 1).width = width
    })

    const rows = await this.rows.listAll(batch.id)
    for (const row of rows.filter((r) => REPORTED.has(r.status))) {
      const columns = sheetOf(row.entity).columns
      const base = [
        sheetOf(row.entity).name,
        row.rowNumber ?? '',
        row.label,
        STATUS_LABELS[row.status],
      ]
      if (row.errors.length > 0) {
        for (const error of row.errors) {
          const header = columns.find((c) => c.key === error.field)?.header
          addSafeRow(sheet, [
            ...base,
            header ?? error.field,
            error.code,
            error.message,
          ])
        }
      } else if (row.conflict) {
        addSafeRow(sheet, [
          ...base,
          row.conflict.differingFields
            .map((f) => columns.find((c) => c.key === f)?.header ?? f)
            .join(', '),
          row.conflict.kind,
          row.conflict.reason,
        ])
      }
    }

    const byProperty = await this.assets.countByProperty(batch.id)
    if (byProperty.size > 0) {
      const photos = workbook.addWorksheet('Fotos')
      addSafeRow(photos, ['Propiedad', 'Fotos migradas', 'Fotos fallidas'])
      photos.getRow(1).font = { bold: true }
      ;[50, 16, 16].forEach((width, i) => {
        photos.getColumn(i + 1).width = width
      })
      const names = await this.properties.describe([...byProperty.keys()])
      for (const [propertyId, counts] of byProperty) {
        addSafeRow(photos, [
          names.get(propertyId)?.address ?? propertyId,
          counts.migrated,
          counts.failed,
        ])
      }
    }

    return Buffer.from(await workbook.xlsx.writeBuffer())
  }
}
