/**
 * Reconoce el formato de un archivo por sus primeros bytes, no por el
 * mimetype o la extensión que mandó el cliente (D-62): los comprobantes son
 * plata y un `.pdf` que no es un PDF no se guarda.
 */
export interface FileKind {
  extension: 'pdf' | 'jpg' | 'png' | 'webp'
  contentType: string
}

const SIGNATURES: { kind: FileKind; matches: (file: Buffer) => boolean }[] = [
  {
    kind: { extension: 'pdf', contentType: 'application/pdf' },
    matches: (file) => file.subarray(0, 4).toString('latin1') === '%PDF',
  },
  {
    kind: { extension: 'jpg', contentType: 'image/jpeg' },
    matches: (file) => file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff,
  },
  {
    kind: { extension: 'png', contentType: 'image/png' },
    matches: (file) =>
      file
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    kind: { extension: 'webp', contentType: 'image/webp' },
    matches: (file) =>
      file.subarray(0, 4).toString('latin1') === 'RIFF' &&
      file.subarray(8, 12).toString('latin1') === 'WEBP',
  },
]

/** Imagen (JPG, PNG, WebP) o PDF; `null` si no es ninguno de esos. */
export function detectFileKind(file: Buffer): FileKind | null {
  return SIGNATURES.find((s) => s.matches(file))?.kind ?? null
}
