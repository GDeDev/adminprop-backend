/**
 * Generación de PDFs (Fase 15, 1). Las plantillas arman una
 * `PdfDocumentDefinition` (datos puros, sin I/O) y el puerto la convierte en
 * bytes. Hoy lo hace `pdfmake`; si el diseño final exige HTML/CSS se suma un
 * adapter Chromium detrás del mismo puerto (A-31) sin tocar las plantillas.
 *
 * Clase abstracta y no interface para usarla como token de inyección.
 */
export abstract class PdfRendererPort {
  abstract render(definition: PdfDocumentDefinition): Promise<Buffer>
}

/** Alineación de una columna o de un texto. */
export type PdfAlign = 'left' | 'right' | 'center'

/** Un documento: encabezado de marca, bloques de contenido y pie. */
export interface PdfDocumentDefinition {
  /** Título del archivo (metadata del PDF). */
  title: string
  header: PdfHeader
  /** Texto en diagonal sobre todas las páginas ("ANULADO"). */
  watermark?: string
  blocks: PdfBlock[]
  /** Líneas del pie de cada página (datos fiscales, leyendas). */
  footerLines: string[]
}

export interface PdfHeader {
  brandName: string
  /** `data:image/png|jpeg;base64,…` o `data:image/svg+xml;base64,…`. Opcional. */
  logoDataUri?: string
  /** Hex `#rrggbb`: encabezados y filas de título de tabla. */
  primaryColor: string
  /** Debajo del nombre (razón social, CUIT, dirección). */
  detailLines: string[]
}

export type PdfBlock =
  | { type: 'title'; text: string; subtitle?: string }
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string; muted?: boolean }
  | { type: 'keyValues'; rows: PdfKeyValue[] }
  | { type: 'table'; table: PdfTable }
  | { type: 'spacer' }

export interface PdfKeyValue {
  label: string
  value: string
  /** Resalta el valor (negrita): totales y netos. */
  emphasis?: boolean
}

export interface PdfTable {
  columns: PdfColumn[]
  rows: string[][]
  /** Filas de total, después de las del cuerpo, en negrita. */
  totalRows?: string[][]
  /** Mensaje si no hay filas ("Sin gastos adelantados"). */
  emptyText?: string
}

export interface PdfColumn {
  header: string
  align?: PdfAlign
  /** Ancho: número fijo en puntos, `auto` o `*` (reparte el resto). */
  width?: number | 'auto' | '*'
}
