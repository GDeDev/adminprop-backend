import { Injectable } from '@nestjs/common'

import {
  AmenityRef,
  Catalog,
  LocationRef,
  MasterDataFacade,
  MasterDataRef,
} from '@/modules/master-data/public'
import { OwnerRef, OwnersFacade } from '@/modules/owners/public/owners.facade'
import {
  ListingCurrency,
  ListingOperation,
  Property,
  PropertyStatus,
} from '../domain/property'

export interface PropertyPhotoView {
  id: string
  url: string
  position: number
}

/** Una fila del listado (spec 5.1): lo justo para la tarjeta o la tabla. */
export interface PropertySummaryView {
  id: string
  address: string
  status: PropertyStatus
  ownerId: string | null
  /** Contrato activo, si lo hay (lo fija el módulo de contratos). */
  activeContractId: string | null
  /** Null si no tiene propietario asignado. */
  owner: OwnerRef | null
  /** Null sólo si el maestro fue borrado a mano de la base (no debería pasar). */
  location: LocationRef | null
  propertyType: MasterDataRef | null
  mainPhotoUrl: string | null
  /** Precio de publicación; null = "Consultar" (Fase 22). */
  listingPrice: string | null
  listingCurrency: ListingCurrency
  publicDescription: string | null
  /** Marcada por una migración para que alguien la revise. */
  needsReview: boolean
  /** Venta o alquiler: cómo se publica en el sitio web. */
  listingOperation: ListingOperation
  createdAt: Date
  updatedAt: Date
}

/** La ficha (spec 3.3): maestros expandidos, no sólo ids. */
export interface PropertyDetailView extends PropertySummaryView {
  locationId: string
  propertyTypeId: string
  amenityIds: string[]
  amenities: AmenityRef[]
  notes: string | null
  photos: PropertyPhotoView[]
  /** Datos de la ficha pública; todos opcionales. */
  bedrooms: number | null
  bathrooms: number | null
  rooms: number | null
  totalAreaM2: number | null
  coveredAreaM2: number | null
  ageYears: number | null
  latitude: number | null
  longitude: number | null
}

/**
 * Arma las vistas buscando los maestros de todas las propiedades juntas: un
 * listado de 20 hace las mismas consultas que una ficha, no 20 veces más.
 * Los maestros desactivados se muestran igual (dato histórico).
 */
@Injectable()
export class PropertyViews {
  constructor(
    private readonly masterData: MasterDataFacade,
    private readonly owners: OwnersFacade,
  ) {}

  async summaries(properties: Property[]): Promise<PropertySummaryView[]> {
    const [locations, types, owners] = await Promise.all([
      this.masterData.describeLocations(properties.map((p) => p.locationId)),
      this.masterData.describeCatalog(
        Catalog.PROPERTY_TYPES,
        properties.map((p) => p.propertyTypeId),
      ),
      this.describeOwners(properties),
    ])
    return properties.map((property) =>
      toSummary(property, locations, types, owners),
    )
  }

  async detail(property: Property): Promise<PropertyDetailView> {
    const [locations, types, amenities, owners] = await Promise.all([
      this.masterData.describeLocations([property.locationId]),
      this.masterData.describeCatalog(Catalog.PROPERTY_TYPES, [
        property.propertyTypeId,
      ]),
      this.masterData.describeAmenities(property.amenityIds),
      this.describeOwners([property]),
    ])

    return {
      ...toSummary(property, locations, types, owners),
      locationId: property.locationId,
      propertyTypeId: property.propertyTypeId,
      amenityIds: property.amenityIds,
      amenities: property.amenityIds
        .map((id) => amenities.get(id))
        .filter((a): a is AmenityRef => a !== undefined),
      notes: property.notes,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      rooms: property.rooms,
      totalAreaM2: property.totalAreaM2,
      coveredAreaM2: property.coveredAreaM2,
      ageYears: property.ageYears,
      latitude: property.latitude,
      longitude: property.longitude,
      photos: property.photos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        position: photo.position,
      })),
    }
  }

  private describeOwners(
    properties: Property[],
  ): Promise<Map<string, OwnerRef>> {
    return this.owners.describe(
      properties.flatMap((p) => (p.ownerId ? [p.ownerId] : [])),
    )
  }
}

function toSummary(
  property: Property,
  locations: Map<string, LocationRef>,
  types: Map<string, MasterDataRef>,
  owners: Map<string, OwnerRef>,
): PropertySummaryView {
  return {
    id: property.id,
    address: property.address,
    status: property.status,
    ownerId: property.ownerId,
    activeContractId: property.activeContractId,
    owner: (property.ownerId && owners.get(property.ownerId)) || null,
    location: locations.get(property.locationId) ?? null,
    propertyType: types.get(property.propertyTypeId) ?? null,
    mainPhotoUrl: property.photos[0]?.url ?? null,
    listingPrice: property.listingPrice,
    listingCurrency: property.listingCurrency,
    publicDescription: property.publicDescription,
    needsReview: property.needsReview,
    listingOperation: property.listingOperation,
    createdAt: property.createdAt,
    updatedAt: property.updatedAt,
  }
}
