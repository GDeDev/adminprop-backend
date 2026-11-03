import { Injectable } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'

import { CreateCatalogItemCommand } from '../application/commands/catalog.commands'
import { CreateLocationCommand } from '../application/commands/location.commands'
import { Catalog, CatalogItem } from '../domain/catalog'
import { Location, LocationLevel } from '../domain/location'
import {
  CatalogRepository,
  LocationRepository,
} from '../domain/master-data.repositories'

/** Un valor de maestro tal como lo muestran otros módulos. */
export interface MasterDataRef {
  id: string
  name: string
  isActive: boolean
}

export interface AmenityRef extends MasterDataRef {
  icon: string | null
}

export interface LocationRef extends MasterDataRef {
  level: LocationLevel
  /** De lo específico a lo general, sin el país: "Tolosa, La Plata, Buenos Aires". */
  path: string
}

/** Un nodo del árbol de ubicaciones, para que una migración arme su índice. */
export interface LocationNodeData {
  id: string
  name: string
  level: LocationLevel
  parentId: string | null
}

/** Nombre del comodín para propiedades migradas sin ubicación (Fase 21, A-77). */
export const UNKNOWN_LOCATION_NAME = 'Sin ubicación (revisar)'

/**
 * Niveles de una ruta nueva según su largo: la hoja siempre es una localidad o
 * un barrio (una propiedad no se ubica en una provincia).
 */
const LEVELS_BY_PATH_LENGTH: Record<number, LocationLevel[]> = {
  1: [LocationLevel.CITY],
  2: [LocationLevel.PROVINCE, LocationLevel.CITY],
  3: [LocationLevel.PROVINCE, LocationLevel.CITY, LocationLevel.NEIGHBORHOOD],
}

const normalizeName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/s+/g, ' ')

/**
 * Lo que otros módulos pueden preguntarle a los maestros. Corre dentro del
 * tenant del contexto: un id de otra inmobiliaria no existe.
 *
 * - Para validar un alta: `areSelectable` / `getLocation` (spec 4: un
 *   desactivado no se elige en altas nuevas).
 * - Para mostrar: los `describe*`, en lote, e incluyen los desactivados (un
 *   registro viejo sigue mostrando su valor).
 */
@Injectable()
export class MasterDataFacade {
  constructor(
    private readonly catalogs: CatalogRepository,
    private readonly locations: LocationRepository,
    private readonly commands: CommandBus,
  ) {}

  // ---------------------------------------------------------- Migración (Fase 21)

  /** Todas las ubicaciones activas, para resolver rutas sin tocar la base una por una. */
  async listLocationNodes(): Promise<LocationNodeData[]> {
    const all = await this.locations.list({ active: 'all' })
    return all.map((l) => ({
      id: l.id,
      name: l.name,
      level: l.level,
      parentId: l.parentId,
    }))
  }

  /** Los ítems de un maestro plano, activos o no (la migración compara por nombre). */
  async listCatalogItems(catalog: Catalog): Promise<MasterDataRef[]> {
    const items = await this.catalogs.list(catalog, 'all')
    return items.map(toRef)
  }

  /**
   * El ítem con ese nombre (sin distinguir mayúsculas ni acentos) o uno nuevo.
   * `created` dice si hubo que crearlo.
   */
  async ensureCatalogItem(
    catalog: Catalog,
    name: string,
  ): Promise<{ id: string; created: boolean }> {
    const wanted = normalizeName(name)
    const existing = (await this.catalogs.list(catalog, 'all')).find(
      (item) => normalizeName(item.name) === wanted,
    )
    if (existing) return { id: existing.id, created: false }
    const created = await this.commands.execute(
      new CreateCatalogItemCommand(catalog, name),
    )
    return { id: created.id, created: true }
  }

  /**
   * La ubicación de esa ruta (de la provincia hacia abajo), creando los
   * niveles que falten. `created` cuenta los nodos nuevos.
   */
  async ensureLocationPath(
    path: string[],
  ): Promise<{ id: string; created: number }> {
    const levels =
      LEVELS_BY_PATH_LENGTH[path.length] ?? LEVELS_BY_PATH_LENGTH[3]
    const parent = await this.countryRoot()
    let created = parent.created ? 1 : 0
    let current = parent.id
    for (const [index, name] of path.entries()) {
      const siblings = await this.locations.list({
        parentId: current,
        active: 'all',
      })
      const match = siblings.find(
        (l) => normalizeName(l.name) === normalizeName(name),
      )
      if (match) {
        current = match.id
        continue
      }
      const node = await this.commands.execute(
        new CreateLocationCommand(levels[index], name, current),
      )
      current = node.id
      created += 1
    }
    return { id: current, created }
  }

  /** El comodín de las propiedades sin ubicación: se crea una sola vez. */
  async ensureUnknownLocation(): Promise<{ id: string; created: number }> {
    return this.ensureLocationPath([UNKNOWN_LOCATION_NAME])
  }

  private async countryRoot(): Promise<{ id: string; created: boolean }> {
    const roots = await this.locations.list({
      level: LocationLevel.COUNTRY,
      parentId: null,
      active: 'all',
    })
    if (roots.length > 0) return { id: roots[0].id, created: false }
    const country = await this.commands.execute(
      new CreateLocationCommand(LocationLevel.COUNTRY, 'Argentina', null),
    )
    return { id: country.id, created: true }
  }

  /** Si todos los ids existen y están activos. Con lista vacía, `true`. */
  async areSelectable(catalog: Catalog, ids: string[]): Promise<boolean> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return true
    return (await this.catalogs.countActive(catalog, unique)) === unique.length
  }

  async isSelectableLocation(id: string): Promise<boolean> {
    const location = await this.locations.findById(id)
    return location?.isActive ?? false
  }

  /** Nivel y estado de una ubicación, o null si no existe. */
  async getLocation(
    id: string,
  ): Promise<{ level: LocationLevel; isActive: boolean } | null> {
    const location = await this.locations.findById(id)
    return location
      ? { level: location.level, isActive: location.isActive }
      : null
  }

  async describeCatalog(
    catalog: Catalog,
    ids: string[],
  ): Promise<Map<string, MasterDataRef>> {
    const items = await this.catalogs.findByIds(catalog, unique(ids))
    return new Map(items.map((item) => [item.id, toRef(item)]))
  }

  async describeAmenities(ids: string[]): Promise<Map<string, AmenityRef>> {
    const items = await this.catalogs.findByIds(Catalog.AMENITIES, unique(ids))
    return new Map(
      items.map((item) => [item.id, { ...toRef(item), icon: item.icon }]),
    )
  }

  /**
   * Ubicaciones con su ruta legible. Sube por los padres de a un nivel, en
   * lote: a lo sumo tres consultas más, sin importar cuántas sean.
   */
  async describeLocations(ids: string[]): Promise<Map<string, LocationRef>> {
    const requested = await this.locations.findByIds(unique(ids))
    const known = new Map<string, Location>(requested.map((l) => [l.id, l]))

    let pending = requested
    while (pending.length > 0) {
      const parentIds = pending
        .map((l) => l.parentId)
        .filter((id): id is string => id !== null && !known.has(id))
      const parents = await this.locations.findByIds(unique(parentIds))
      for (const parent of parents) known.set(parent.id, parent)
      pending = parents
    }

    return new Map(
      requested.map((location) => [
        location.id,
        {
          id: location.id,
          name: location.name,
          isActive: location.isActive,
          level: location.level,
          path: pathOf(location, known),
        },
      ]),
    )
  }
}

function pathOf(location: Location, known: Map<string, Location>): string {
  const names: string[] = []
  let current: Location | undefined = location
  while (current) {
    // El país no aporta: todas las propiedades son del mismo.
    if (current.level !== LocationLevel.COUNTRY) names.push(current.name)
    current = current.parentId ? known.get(current.parentId) : undefined
  }
  return names.join(', ')
}

function toRef(item: CatalogItem): MasterDataRef {
  return { id: item.id, name: item.name, isActive: item.isActive }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}
