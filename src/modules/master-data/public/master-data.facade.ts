import { Injectable } from '@nestjs/common'

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
  ) {}

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
