import { ActiveFilter, Catalog, CatalogItem } from './catalog'
import { Location, LocationLevel } from './location'

export interface CatalogItemData {
  name: string
  /** Sólo se guarda en amenities; en el resto se ignora. */
  icon?: string | null
}

/**
 * Los cuatro maestros planos. Todo corre dentro del tenant del contexto.
 * Clase abstracta y no interface: NestJS la necesita como token en runtime.
 */
export abstract class CatalogRepository {
  /** Ordenados por nombre. Son listas cortas: sin paginar. */
  abstract list(catalog: Catalog, filter: ActiveFilter): Promise<CatalogItem[]>

  abstract findById(catalog: Catalog, id: string): Promise<CatalogItem | null>

  /** Sin distinguir mayúsculas, como el índice único. */
  abstract existsByName(
    catalog: Catalog,
    name: string,
    exceptId?: string,
  ): Promise<boolean>

  abstract create(catalog: Catalog, data: CatalogItemData): Promise<CatalogItem>

  abstract update(
    catalog: Catalog,
    id: string,
    data: Partial<CatalogItemData>,
  ): Promise<CatalogItem>

  abstract setActive(
    catalog: Catalog,
    id: string,
    isActive: boolean,
  ): Promise<CatalogItem>

  /** Cuántos de estos ids existen y están activos (para la facade). */
  abstract countActive(catalog: Catalog, ids: string[]): Promise<number>
}

export interface LocationFilter {
  level?: LocationLevel
  /** `null`: sólo las de nivel raíz (sin padre). Ausente: cualquier padre. */
  parentId?: string | null
  active: ActiveFilter
}

export abstract class LocationRepository {
  abstract list(filter: LocationFilter): Promise<Location[]>

  abstract findById(id: string): Promise<Location | null>

  /** Mismo padre y mismo nombre, sin distinguir mayúsculas. */
  abstract existsByName(
    parentId: string | null,
    name: string,
    exceptId?: string,
  ): Promise<boolean>

  abstract create(data: {
    level: LocationLevel
    name: string
    parentId: string | null
  }): Promise<Location>

  abstract rename(id: string, name: string): Promise<Location>

  abstract setActive(id: string, isActive: boolean): Promise<Location>
}
