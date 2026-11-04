import { Injectable } from '@nestjs/common'

import { IsoDate, localDateOf } from '@/shared/dates/calendar-date'
import { PropertyTypeNames } from '../application/property-type-names'
import {
  ListingCurrency,
  ListingOperation,
  PropertyStatus,
} from '../domain/property'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import {
  PublicFiltersView,
  PublicPropertyDetailView,
  PublicPropertySummaryView,
  PublicPropertyViews,
} from '../application/public-property.views'
import {
  PropertyRepository,
  PublicPropertyFilter,
} from '../domain/property.ports'

export { ListingCurrency, ListingOperation, PropertyStatus }
export type {
  PublicFiltersView,
  PublicPropertyDetailView,
  PublicPropertySummaryView,
  PublicPropertyFilter,
}

export interface OwnerPortfolio {
  /** Todas sus propiedades no borradas. */
  total: number
  /**
   * Las que cuentan como "activas" para el honorario reducido (RN-07): las
   * que tienen un contrato activo. Una alquilada a mano, sin contrato, no
   * cuenta (D-39, cerrada en la Fase 9).
   */
  active: number
}

export interface OwnerPropertySummary {
  id: string
  address: string
  status: PropertyStatus
  mainPhotoUrl: string | null
}

/** Lo justo para mostrar una propiedad desde otro módulo. */
export interface PropertyRef {
  id: string
  address: string
}

/** Lo que un contrato necesita saber de la propiedad al armarse. */
export interface PropertyContractInfo extends PropertyRef {
  status: PropertyStatus
  ownerId: string | null
  activeContractId: string | null
}

/** Una propiedad para los reportes de la Fase 19. */
export interface PropertyReportRef {
  id: string
  address: string
  status: PropertyStatus
  ownerId: string | null
  /** Alta en el sistema (día en UTC), desde cuando cuenta si nunca se alquiló. */
  createdAt: IsoDate
}

/**
 * Lo que otros módulos pueden preguntarle a propiedades. Dentro del tenant
 * del contexto: un id de otra inmobiliaria es un id que no existe.
 *
 * `attachContract` y `detachContract` son el único camino por el que una
 * propiedad se entera de sus contratos: el módulo de contratos los llama
 * dentro de su transacción, y propiedades nunca importa a contratos (D-51).
 */
@Injectable()
export class PropertiesFacade {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly typeNamesOf: PropertyTypeNames,
    private readonly publicViews: PublicPropertyViews,
  ) {}

  // ---------------------------------------------------- Portal público (Fase 22)
  // Dentro del tenant del contexto. Sólo propiedades `AVAILABLE` y sólo la
  // lista blanca de `PublicPropertyViews`: nada de propietario ni contrato.

  /** Disponibles, más nuevas primero (`GET /public/:slug/properties`). */
  listPublic(
    filter: PublicPropertyFilter,
    page: Partial<PaginationQueryDto>,
  ): Promise<PaginatedResult<PublicPropertySummaryView>> {
    return paginateWith(page, async (args) => {
      const [properties, total] = await this.properties.listPublic(filter, args)
      return [await this.publicViews.summaries(properties), total]
    })
  }

  /** La ficha pública, o null si no existe o ya no está disponible. */
  async getPublic(id: string): Promise<PublicPropertyDetailView | null> {
    const property = await this.properties.findPublicById(id)
    return property ? this.publicViews.detail(property) : null
  }

  /** Id y dirección si la propiedad está disponible para el público; null si no. */
  async publicRef(id: string): Promise<PropertyRef | null> {
    const property = await this.properties.findPublicById(id)
    return property ? { id: property.id, address: property.address } : null
  }

  /** Tipos y ubicaciones de las propiedades disponibles, para los selects. */
  async publicFilters(): Promise<PublicFiltersView> {
    const { propertyTypeIds, locationIds } =
      await this.properties.publicFilterOptions()
    return this.publicViews.filters(propertyTypeIds, locationIds)
  }

  /** Nombre del tipo de cada propiedad (casa, departamento…), para el portal (Fase 18). */
  async typeNames(ids: string[]): Promise<Map<string, string>> {
    return this.typeNamesOf.of(
      await this.properties.findByIds([...new Set(ids)]),
    )
  }

  async find(id: string): Promise<PropertyContractInfo | null> {
    const property = await this.properties.findById(id)
    return property
      ? {
          id: property.id,
          address: property.address,
          status: property.status,
          ownerId: property.ownerId,
          activeContractId: property.activeContractId,
        }
      : null
  }

  /** Dirección de cada una, en una sola consulta. Las borradas no aparecen. */
  async describe(ids: string[]): Promise<Map<string, PropertyRef>> {
    const properties = await this.properties.findByIds([...new Set(ids)])
    return new Map(
      properties.map((property) => [
        property.id,
        { id: property.id, address: property.address },
      ]),
    )
  }

  /** Todas las propiedades no borradas, por dirección (reportes, Fase 19). */
  async listForReport(): Promise<PropertyReportRef[]> {
    const properties = await this.properties.listAll({})
    return properties.map((property) => ({
      id: property.id,
      address: property.address,
      status: property.status,
      ownerId: property.ownerId,
      createdAt: localDateOf(property.createdAt),
    }))
  }

  async portfolios(ownerIds: string[]): Promise<Map<string, OwnerPortfolio>> {
    const counts = await this.properties.countByOwners([...new Set(ownerIds)])
    const result = new Map<string, OwnerPortfolio>(
      ownerIds.map((id) => [id, { total: 0, active: 0 }]),
    )
    for (const { ownerId, total, active } of counts) {
      result.set(ownerId, { total, active })
    }
    return result
  }

  async listByOwner(ownerId: string): Promise<OwnerPropertySummary[]> {
    const properties = await this.properties.listByOwner(ownerId)
    return properties.map((property) => ({
      id: property.id,
      address: property.address,
      status: property.status,
      mainPhotoUrl: property.photos[0]?.url ?? null,
    }))
  }

  /** La propiedad pasa a alquilada con ese contrato como activo. */
  async attachContract(propertyId: string, contractId: string): Promise<void> {
    await this.properties.attachContract(propertyId, contractId)
  }

  /** La propiedad vuelve a disponible, sin contrato activo. */
  async detachContract(propertyId: string): Promise<void> {
    await this.properties.detachContract(propertyId)
  }
}
