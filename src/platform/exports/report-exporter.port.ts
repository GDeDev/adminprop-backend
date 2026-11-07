/**
 * Exportación de tablas a archivos (Fase 19). Los reportes y la auditoría
 * arman una `ExportTable` (datos puros, ya formateados por el dominio) y el
 * puerto la convierte en bytes. Hoy el XLSX lo escribe `exceljs`; el PDF no
 * pasa por acá sino por `PdfRendererPort` (platform/pdf).
 *
 * Clase abstracta y no interface para usarla como token de inyección.
 */
export abstract class ReportExporterPort {
  abstract toXlsx(table: ExportTable): Promise<Buffer>

  abstract toCsv(table: ExportTable): Buffer
}

/** Cómo se muestra una columna. Los montos llegan como string decimal. */
export type ExportColumnKind = 'text' | 'money' | 'integer'

export interface ExportColumn {
  header: string
  kind?: ExportColumnKind
  /** Ancho aproximado en caracteres (sólo XLSX). */
  width?: number
}

export type ExportCell = string | number | null

export interface ExportTable {
  /** Título de la hoja y del archivo. */
  title: string
  /** Encabezado: pares etiqueta/valor (filtros aplicados, fecha de emisión). */
  meta: [string, string][]
  columns: ExportColumn[]
  rows: ExportCell[][]
  /** Filas de total, después del cuerpo, en negrita. */
  totalRows?: ExportCell[][]
}
