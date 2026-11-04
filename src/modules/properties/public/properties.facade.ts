import { Injectable } from '@nestjs/common'
import { CommandBus, EventBus } from '@nestjs/cqrs'

import { fillEmptyFields } from '@/shared/core/fill-empty-fields'
import { IsoDate, localDateOf } from '@/shared/dates/calendar-date'
import {
  AddPropertyPhotosCommand,
  CreatePropertyCommand,
  UpdatePropertyCommand,
} from '../application/commands/property.commands'
import { PropertyTypeNames } from '../application/property-type-names'
import {
  ListingCurrency,
  ListingOperation,
  Property,
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
  PUBLIC_PROPERTY_SORTS,
  PropertyRepository,
  PublicPropertyFilter,
  PublicPropertySort,
} from '../domain/property.ports'

/** La propiedad pasó a alquilada (la publica `attachContract`). Lo escucha el CRM para cerrar sus publicaciones (Fase 23, A-87). */
export class PropertyRentedEvent {
  constructor(
    public readonly propertyId: string,
    public readonly contractId: string,
  ) {}
}

/** Lo que un portal de publicación necesita de una propiedad (Fase 23). */
export interface PropertyListingInfo {
  id: string
  title: string
  address: string
  location: string
  neighborhood: string | null
  propertyType: string
  status: PropertyStatus
  price: string | null
  currency: ListingCurrency
  description: string | null
  photoUrls: string[]
  amenities: string[]
  /** Cambia con cada edición de la ficha. */
  updatedAt: Date
}

export {
  ListingCurrency,
  ListingOperation,
  PropertyStatus,
  PUBLIC_PROPERTY_SORTS,
}
export type {
  PublicPropertySort,
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
 * Lo que la tasación (Fase 24) necesita de una propiedad: ubicación, tipo y
 * comodidades. Sin dirección, propietario ni notas: no hacen falta y nunca
 * deben llegar a un redactor externo.
 */
export interface PropertyValuationInfo {
  id: string
  locationId: string
  propertyTypeId: string
  amenityIds: string[]
  listingCurrency: ListingCurrency
}

/** Una propiedad tal como la trae una migración (Fase 21). */
export interface PropertyImportData {
  address: string
  locationId: string
  propertyTypeId: string
  ownerId: string | null
  amenityIds: string[]
  listingPrice: string | null
  /** Null: la moneda de la inmobiliaria. */
  listingCurrency: ListingCurrency | null
  publicDescription: string | null
  notes: string | null
  needsReview: boolean
}

/** Lo que una migración necesita ver de una propiedad existente. */
export interface PropertyImportSnapshot {
  id: string
  address: string
  locationId: string
  ownerId: string | null
  listingPrice: string | null
  publicDescription: string | null
  notes: string | null
  amenityCount: number
  activeContractId: string | null
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
    private readonly commands: CommandBus,
    private readonly events: EventBus,
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

  // ------------------------------------------------------ Multipublicación (Fase 23)

  /** La ficha armada para un portal, o null si no existe en esta inmobiliaria. */
  async getForListing(id: string): Promise<PropertyListingInfo | null> {
    const property = await this.properties.findById(id)
    if (!property) return null
    const detail = await this.publicViews.detail(property)
    return {
      id: property.id,
      title: detail.title,
      address: property.address,
      location: detail.location,
      neighborhood: detail.neighborhood,
      propertyType: detail.propertyType,
      status: property.status,
      price: property.listingPrice,
      currency: property.listingCurrency,
      description: property.publicDescription,
      photoUrls: property.photos.map((photo) => photo.url),
      amenities: detail.amenities,
      updatedAt: property.updatedAt,
    }
  }

  // ------------------------------------------------------------ Tasación (Fase 24)

  /** Lo que la tasación necesita de la propiedad, o null si no existe en esta inmobiliaria. */
  async getForValuation(id: string): Promise<PropertyValuationInfo | null> {
    const property = await this.properties.findById(id)
    return property ? toValuationInfo(property) : null
  }

  /** Las disponibles: de ahí salen las zonas que vale la pena refrescar (A-63). */
  async listAvailableForValuation(): Promise<PropertyValuationInfo[]> {
    const properties = await this.properties.listAll({
      status: PropertyStatus.AVAILABLE,
    })
    return properties.map(toValuationInfo)
  }

  // ---------------------------------------------------------- Migración (Fase 21)

  /** Las propiedades de esas ubicaciones, para detectar duplicados por dirección. */
  async listForImport(
    locationIds: string[],
  ): Promise<PropertyImportSnapshot[]> {
    if (locationIds.length === 0) return []
    const wanted = new Set(locationIds)
    const properties = await this.properties.listAll({})
    return properties
      .filter((property) => wanted.has(property.locationId))
      .map((property) => ({
        id: property.id,
        address: property.address,
        locationId: property.locationId,
        ownerId: property.ownerId,
        listingPrice: property.listingPrice,
        publicDescription: property.publicDescription,
        notes: property.notes,
        amenityCount: property.amenityIds.length,
        activeContractId: property.activeContractId,
      }))
  }

  /** Alta con las mismas validaciones y auditoría que la manual. */
  async createFromImport(data: PropertyImportData): Promise<string> {
    const created = await this.commands.execute(
      new CreatePropertyCommand({
        // La migración no trae los datos de la ficha del sitio web: quedan vacíos.
        bedrooms: null,
        bathrooms: null,
        rooms: null,
        totalAreaM2: null,
        coveredAreaM2: null,
        ageYears: null,
        latitude: null,
        longitude: null,
        ...data,
        listingCurrency: data.listingCurrency ?? undefined,
      }),
    )
    return created.id
  }

  /** Completa sólo lo vacío (A-72); devuelve los campos que completó. */
  async fillEmptyFields(
    id: string,
    data: PropertyImportData,
  ): Promise<string[]> {
    const property = await this.properties.findById(id)
    if (!property) return []
    const patch: Record<string, unknown> = fillEmptyFields(
      property,
      data as unknown as Record<string, unknown>,
      ['ownerId', 'listingPrice', 'publicDescription', 'notes'],
    )
    if (property.amenityIds.length === 0 && data.amenityIds.length > 0) {
      patch.amenityIds = data.amenityIds
    }
    if (Object.keys(patch).length > 0) {
      await this.commands.execute(new UpdatePropertyCommand(id, patch))
    }
    return Object.keys(patch)
  }

  /** Suma una foto traída de otro sistema, al final de las que ya tiene. */
  async addPhotoFromImport(
    propertyId: string,
    photo: { buffer: Buffer; mimeType: string },
  ): Promise<void> {
    await this.commands.execute(
      new AddPropertyPhotosCommand(propertyId, [photo]),
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
    this.events.publish(new PropertyRentedEvent(propertyId, contractId))
  }

  /** La propiedad vuelve a disponible, sin contrato activo. */
  async detachContract(propertyId: string): Promise<void> {
    await this.properties.detachContract(propertyId)
  }
}

function toValuationInfo(property: Property): PropertyValuationInfo {
  return {
    id: property.id,
    locationId: property.locationId,
    propertyTypeId: property.propertyTypeId,
    amenityIds: property.amenityIds,
    listingCurrency: property.listingCurrency,
  }
}
