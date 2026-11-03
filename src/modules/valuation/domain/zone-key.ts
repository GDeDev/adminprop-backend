/**
 * Zona de mercado (Fase 24, A-61). Las ubicaciones de Maestros son por
 * inmobiliaria y el caché de comparables es global; lo que las une es el
 * *nombre* de la jerarquía: `caba/palermo`, `buenos-aires/la-plata/city-bell`.
 */

/** Minúsculas, sin acentos, sin signos: `"City Bell"` → `"city-bell"`. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * La clave de la zona a partir de los nombres de la jerarquía, de lo general
 * a lo específico y sin el país (`["Buenos Aires", "La Plata", "City Bell"]`).
 * Devuelve null si no queda ningún nombre usable.
 */
export function buildZoneKey(path: string[]): string | null {
  const slugs = path.map(slugify).filter((slug) => slug.length > 0)
  return slugs.length > 0 ? slugs.join('/') : null
}

/** La zona que contiene a esta, o null si ya es la más amplia. */
export function parentZoneKey(zoneKey: string): string | null {
  const index = zoneKey.lastIndexOf('/')
  return index > 0 ? zoneKey.slice(0, index) : null
}

/** Los nombres que mostramos de una zona: el más específico y el que lo contiene. */
export function buildZoneLabel(path: string[]): string {
  const names = path.map((name) => name.trim()).filter(Boolean)
  return names.slice(-2).reverse().join(', ')
}

/** Los `n` últimos tramos de la clave: lo que usan las fuentes para armar su URL. */
export function zoneSegments(zoneKey: string): string[] {
  return zoneKey.split('/').filter(Boolean)
}
