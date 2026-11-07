/**
 * Chequeo de seguridad para SVG subidos por usuarios (logos de inmobiliarias).
 *
 * Un SVG es XML con capacidades activas: puede traer scripts, cargar recursos
 * externos (`<image href="http://...">`, `url(http://...)`) o entidades XML.
 * Se sirve desde un CDN y se embebe en PDFs con `svg-to-pdfkit`, que puede
 * resolver referencias externas del lado del servidor. Para un logo nada de eso
 * hace falta, así que **se rechaza** en vez de intentar sanear: una lista de lo
 * permitido es más fácil de razonar que un sanitizador.
 *
 * Es deliberadamente conservador: ante la duda, no es seguro.
 */

/** Etiquetas con comportamiento activo o que cargan contenido ajeno. */
const FORBIDDEN_TAGS =
  /<\s*(script|foreignObject|iframe|object|embed|audio|video|canvas|animate|animateMotion|animateTransform|set|handler|listener|a)\b/i

/** Entidades XML y subconjunto interno del DOCTYPE (XXE, billion laughs). */
const ENTITY_OR_SUBSET = /<!ENTITY|<!DOCTYPE[^>]*\[|<!ELEMENT|<!ATTLIST/i

/** Manejadores de eventos: `onload=`, `onclick=`, etc. */
const EVENT_HANDLER = /[\s"'/]on[a-z]+\s*=/i

const ACTIVE_SCHEMES = /(javascript|vbscript|data\s*:\s*text\/html)\s*:?/i

const HREF = /(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi

/** Una referencia es local (`#id`) o una imagen raster embebida en base64. */
const SAFE_REFERENCE =
  /^\s*(#|data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$)/i

/** `url(...)` sólo puede apuntar a un id local (gradientes, filtros, máscaras). */
const URL_FUNCTION = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi

const CSS_IMPORT = /@import/i

export function isSafeSvg(svg: Buffer | string): boolean {
  const text = typeof svg === 'string' ? svg : svg.toString('utf8')

  if (ENTITY_OR_SUBSET.test(text)) return false
  if (FORBIDDEN_TAGS.test(text)) return false
  if (EVENT_HANDLER.test(text)) return false
  if (CSS_IMPORT.test(text)) return false
  if (
    ACTIVE_SCHEMES.test(
      text.replace(/data:image\/[a-z+]+;base64,[^"')]*/gi, ''),
    )
  ) {
    return false
  }

  for (const match of text.matchAll(HREF)) {
    const value = match[1] ?? match[2] ?? ''
    if (!SAFE_REFERENCE.test(value)) return false
  }

  for (const match of text.matchAll(URL_FUNCTION)) {
    const target = (match[2] ?? '').trim()
    if (!target.startsWith('#')) return false
  }

  return true
}
