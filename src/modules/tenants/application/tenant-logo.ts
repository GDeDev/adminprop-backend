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

/**
 * Elementos que ejecutan código, embeben otro documento o cambian atributos
 * en tiempo de ejecución (`<set>`/`<animate>` pueden apuntar un `href` a
 * `javascript:`).
 */
const FORBIDDEN_ELEMENT =
  /<\s*(script|foreignObject|iframe|embed|object|set|animate\w*|handler|listener)\b/i
const EVENT_HANDLER_ATTRIBUTE = /[\s"'/]on[a-z]+\s*=/i
const SCRIPT_URL = /(javascript|vbscript)\s*:/i
const HREF_ATTRIBUTE = /\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const SAFE_HREF = /^(#|data:image\/(png|jpe?g|webp|gif);base64,)/i
const EXTERNAL_CSS = /@import|url\(\s*(?!['"]?#)/i
const NON_BASIC_ENTITY = /&(?!(amp|lt|gt|quot|apos);)/i

/**
 * Por qué un SVG no se puede aceptar, o `null` si es inocuo (D-198).
 *
 * Un SVG abierto directo desde el storage ejecuta sus `<script>`. En vez de
 * sanear —que obliga a parsear XML adversarial y a confiar en una lista de
 * permitidos que siempre queda corta— se rechaza lo que ningún logo necesita:
 * scripts, handlers, `<foreignObject>`, DOCTYPE con entidades, referencias
 * externas y entidades numéricas, que se usan para ofuscar `javascript:`.
 */
export function findUnsafeSvgReason(file: Buffer): string | null {
  const text = file.toString('utf8')

  if (FORBIDDEN_ELEMENT.test(text)) {
    return 'el SVG no puede tener scripts ni elementos incrustados'
  }
  if (EVENT_HANDLER_ATTRIBUTE.test(text) || SCRIPT_URL.test(text)) {
    return 'el SVG no puede tener manejadores de eventos ni URLs de script'
  }
  if (/<!ENTITY/i.test(text) || /<!DOCTYPE[^>]*\[/i.test(text)) {
    return 'el SVG no puede declarar entidades'
  }
  if (NON_BASIC_ENTITY.test(text)) {
    return 'el SVG no puede usar entidades numéricas o personalizadas'
  }
  for (const match of text.matchAll(HREF_ATTRIBUTE)) {
    const target = (match[1] ?? match[2] ?? '').trim()
    if (!SAFE_HREF.test(target)) {
      return 'el SVG no puede referenciar recursos externos'
    }
  }
  if (EXTERNAL_CSS.test(text)) {
    return 'el SVG no puede cargar estilos o recursos externos'
  }
  return null
}
