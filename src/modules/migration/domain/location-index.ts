import { normalizePathKey, normalizeText } from './import-normalizers'

export interface LocationNodeRef {
  id: string
  name: string
  /** `COUNTRY`, `PROVINCE`, `CITY` o `NEIGHBORHOOD`. */
  level: string
  parentId: string | null
}

/** Niveles que ocupa una ruta de ubicación, sin el país. */
export const PATH_LEVELS = ['PROVINCE', 'CITY', 'NEIGHBORHOOD'] as const
export const MAX_PATH_LENGTH = PATH_LEVELS.length

export type LocationResolution =
  /** La ruta completa ya existe. */
  | { kind: 'FOUND'; id: string; path: string[]; level: string }
  /** Existe una parte: el resto se crea al confirmar. */
  | { kind: 'NEW'; path: string[] }
  /** Un solo nombre que está en más de un lugar. */
  | { kind: 'AMBIGUOUS'; name: string }
  /** Un solo nombre que no existe: sin la ruta no se sabe dónde crearlo. */
  | { kind: 'UNKNOWN_NAME'; name: string }
  | { kind: 'TOO_DEEP' }

/**
 * Busca rutas ("Provincia > Ciudad > Barrio") en el árbol de ubicaciones del
 * tenant, sin tocar la base: se arma una vez con la lista completa. Sirve al
 * análisis, que no puede crear nada.
 */
export class LocationIndex {
  private readonly byId = new Map<string, LocationNodeRef>()
  private readonly children = new Map<string, LocationNodeRef[]>()
  private readonly byName = new Map<string, LocationNodeRef[]>()
  private readonly countries: LocationNodeRef[]

  constructor(locations: LocationNodeRef[]) {
    for (const location of locations) {
      this.byId.set(location.id, location)
      const parent = location.parentId ?? 'root'
      this.children.set(parent, [
        ...(this.children.get(parent) ?? []),
        location,
      ])
      const key = normalizeText(location.name)
      this.byName.set(key, [...(this.byName.get(key) ?? []), location])
    }
    this.countries = locations.filter((l) => l.level === 'COUNTRY')
  }

  /** Nombres de la raíz al nodo, sin el país. */
  pathOf(id: string): string[] {
    const names: string[] = []
    let current = this.byId.get(id)
    while (current) {
      if (current.level !== 'COUNTRY') names.unshift(current.name)
      current = current.parentId ? this.byId.get(current.parentId) : undefined
    }
    return names
  }

  resolve(rawPath: string[]): LocationResolution {
    let path = rawPath
    // El país es opcional: "Argentina > Buenos Aires > ..." es lo mismo.
    const first = path[0] && normalizeText(path[0])
    const country = this.countries.find((c) => normalizeText(c.name) === first)
    if (country && path.length > 1) path = path.slice(1)
    if (path.length > MAX_PATH_LENGTH) return { kind: 'TOO_DEEP' }

    if (path.length === 1) {
      const matches = (this.byName.get(normalizeText(path[0])) ?? []).filter(
        (l) => l.level !== 'COUNTRY',
      )
      if (matches.length === 1) {
        return {
          kind: 'FOUND',
          id: matches[0].id,
          path: this.pathOf(matches[0].id),
          level: matches[0].level,
        }
      }
      return matches.length > 1
        ? { kind: 'AMBIGUOUS', name: path[0] }
        : { kind: 'UNKNOWN_NAME', name: path[0] }
    }

    let parent: LocationNodeRef | null = this.countries[0] ?? null
    let found: LocationNodeRef | null = null
    for (const segment of path) {
      const siblings: LocationNodeRef[] =
        this.children.get(parent?.id ?? 'root') ?? []
      const match: LocationNodeRef | undefined = siblings.find(
        (l) => normalizeText(l.name) === normalizeText(segment),
      )
      if (!match) return { kind: 'NEW', path }
      found = match
      parent = match
    }
    return found
      ? {
          kind: 'FOUND',
          id: found.id,
          path: this.pathOf(found.id),
          level: found.level,
        }
      : { kind: 'NEW', path }
  }

  /**
   * Claves de los nodos de una ruta que no existen todavía (una por nivel
   * faltante). Dos filas que piden el mismo barrio nuevo cuentan una vez.
   */
  missingNodeKeys(path: string[]): string[] {
    const resolution = this.resolve(path)
    if (resolution.kind !== 'NEW') return []
    const keys: string[] = []
    let existing = true
    let parent: LocationNodeRef | null = this.countries[0] ?? null
    resolution.path.forEach((segment, index) => {
      if (existing) {
        const match = (this.children.get(parent?.id ?? 'root') ?? []).find(
          (l) => normalizeText(l.name) === normalizeText(segment),
        )
        if (match) {
          parent = match
          return
        }
        existing = false
      }
      keys.push(normalizePathKey(resolution.path.slice(0, index + 1)))
    })
    return keys
  }
}

/** Una propiedad se ubica en una localidad o en un barrio, no en una provincia. */
export const SELECTABLE_LEVELS = ['CITY', 'NEIGHBORHOOD']
