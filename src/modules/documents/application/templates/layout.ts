import { PdfBlock, PdfDocumentDefinition } from '@/platform/pdf/pdf.port'
import { IsoDate } from '@/shared/dates/calendar-date'
import { formatDate } from './format'

/** La marca ya resuelta que comparten las cuatro plantillas. */
export interface DocumentBranding {
  brandName: string
  /** `data:image/...;base64,...`; ausente si no hay logo o no se pudo bajar. */
  logoDataUri?: string
  /** `#rrggbb`. */
  primaryColor: string
  /** Razón social, CUIT, dirección, contacto. */
  detailLines: string[]
  /** Datos fiscales y leyenda configurable (A-34). */
  footerLines: string[]
}

export const DEFAULT_PRIMARY_COLOR = '#c2410c'

/** Arma encabezado, pie y marca de agua; la plantilla sólo aporta los bloques. */
export function buildDocument(
  branding: DocumentBranding,
  title: string,
  blocks: PdfBlock[],
  options: { watermark?: string; generatedOn: IsoDate },
): PdfDocumentDefinition {
  return {
    title,
    header: {
      brandName: branding.brandName,
      logoDataUri: branding.logoDataUri,
      primaryColor: branding.primaryColor,
      detailLines: branding.detailLines,
    },
    watermark: options.watermark,
    blocks,
    footerLines: [
      ...branding.footerLines,
      `Documento generado el ${formatDate(options.generatedOn)}`,
    ],
  }
}
