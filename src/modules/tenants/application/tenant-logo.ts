/** Tamaño máximo del logo. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024

export interface LogoFormat {
  extension: 'png' | 'jpg' | 'webp' | 'svg'
  contentType: string
}

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex')
const SVG_START =
  /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i

/**
 * Detecta el formato por los primeros bytes, no por el `Content-Type` que
 * manda el cliente. Devuelve `null` si no es un formato aceptado.
 */
export function detectLogoFormat(file: Buffer): LogoFormat | null {
  if (file.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { extension: 'png', contentType: 'image/png' }
  }
  if (file.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
    return { extension: 'jpg', contentType: 'image/jpeg' }
  }
  if (
    file.length >= 12 &&
    file.subarray(0, 4).toString('ascii') === 'RIFF' &&
    file.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { extension: 'webp', contentType: 'image/webp' }
  }
  const head = file.subarray(0, 1024).toString('utf8').trimStart()
  if (SVG_START.test(head)) {
    return { extension: 'svg', contentType: 'image/svg+xml' }
  }
  return null
}
