import type { Response } from 'express'

export interface Attachment {
  buffer: Buffer
  filename: string
  contentType: string
}

/** Content-Type de cada formato de exportación. */
export const EXPORT_CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
} as const

/** Responde un archivo como descarga (`Content-Disposition: attachment`). */
export function sendAttachment(res: Response, file: Attachment): void {
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.buffer.length),
    'Content-Disposition': `attachment; filename="${file.filename}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    'Cache-Control': 'no-store',
  })
  res.end(file.buffer)
}
