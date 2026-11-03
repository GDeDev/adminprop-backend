import { Injectable } from '@nestjs/common'

import {
  AmenityRef,
  Catalog,
  LocationLevel,
  LocationRef,
  MasterDataFacade,
  MasterDataRef,
} from '@/modules/master-data/public'
import { Property } from '../domain/property'

/** Una propiedad en el listado del portal público (Fase 22, contrato `PublicPropertySummary`). */
export interface PublicPropertySummaryView {
  id: string
  /** Dirección corta: lo que va antes de la primera coma. */
  title: string
  address: string
  propertyType: string
  neighborhood: string | null
  /** Hoy la propiedad no carga ambientes ni superficie: salen null (D-139). */
  bedrooms: number | null
  bathrooms: number | null
  areaM2: number | null
  price: string | null
  currency: string | null
  coverPhotoUrl: string | null
  amenities: string[]
}

export interface PublicPropertyDetailView extends PublicPropertySummaryView {
  publicDescription: string | null
  photos: { id: string; url: string }[]
  /** "Barrio, ciudad". */
  location: string
  features: { label: string; value: string }[]
}

export interface PublicFiltersView {
  propertyTypes: { id: string; name: string }[]
  locations: { id: string; name: string }[]
}

interface Lookups {
  locations: Map<string, LocationRef>
  types: Map<string, MasterDataRef>
  amenities: Map<string, AmenityRef>
}

/**
 * Arma lo que el portal público puede ver de una propiedad. Es una lista
 * blanca: propietario, contrato, notas internas y estado no pasan por acá
 * (Fase 22, 3). Los maestros se buscan en lote, como en `PropertyViews`.
 */
@Injectable()
export class PublicPropertyViews {
  constructor(private readonly masterData: MasterDataFacade) {}

  async summaries(
    properties: Property[],
  ): Promise<PublicPropertySummaryView[]> {
    const lookups = await this.lookups(properties)
    return properties.map((property) => toSummary(property, lookups))
  }

  async detail(property: Property): Promise<PublicPropertyDetailView> {
    const lookups = await this.lookups([property])
    const location = lookups.locations.get(property.locationId)
    const type = lookups.types.get(property.propertyTypeId)
    const place = shortPlace(location)

    return {
      ...toSummary(property, lookups),
      publicDescription: property.publicDescription,
      photos: property.photos.map(({ id, url }) => ({ id, url })),
      location: place,
      features: [
        ...(type ? [{ label: 'Tipo', value: type.name }] : []),
        ...(place ? [{ label: 'Ubicación', value: place }] : []),
      ],
    }
  }

  /** Tipos y ubicaciones en uso, por nombre (los selects del portal). */
  async filters(
    propertyTypeIds: string[],
    locationIds: string[],
  ): Promise<PublicFiltersView> {
    const [types, locations] = await Promise.all([
      this.masterData.describeCatalog(Catalog.PROPERTY_TYPES, propertyTypeIds),
      this.masterData.describeLocations(locationIds),
    ])
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, 'es')
    return {
      propertyTypes: [...types.values()]
        .map(({ id, name }) => ({ id, name }))
        .sort(byName),
      locations: [...locations.values()]
        .map((location) => ({ id: location.id, name: shortPlace(location) }))
        .sort(byName),
    }
  }

  private async lookups(properties: Property[]): Promise<Lookups> {
    const [locations, types, amenities] = await Promise.all([
      this.masterData.describeLocations(properties.map((p) => p.locationId)),
      this.masterData.describeCatalog(
        Catalog.PROPERTY_TYPES,
        properties.map((p) => p.propertyTypeId),
      ),
      this.masterData.describeAmenities(
        properties.flatMap((p) => p.amenityIds),
      ),
    ])
    return { locations, types, amenities }
  }
}

/** "Tolosa, La Plata, Buenos Aires" → "Tolosa, La Plata". */
function shortPlace(location: LocationRef | undefined): string {
  return location ? location.path.split(', ').slice(0, 2).join(', ') : ''
}

function toSummary(
  property: Property,
  { locations, types, amenities }: Lookups,
): PublicPropertySummaryView {
  const location = locations.get(property.locationId)
  return {
    id: property.id,
    title: property.address.split(',')[0].trim(),
    address: property.address,
    propertyType: types.get(property.propertyTypeId)?.name ?? '',
    neighborhood:
      location?.level === LocationLevel.NEIGHBORHOOD ? location.name : null,
    bedrooms: null,
    bathrooms: null,
    areaM2: null,
    // Sin precio es "Consultar": tampoco se manda la moneda.
    price: property.listingPrice,
    currency: property.listingPrice ? property.listingCurrency : null,
    coverPhotoUrl: property.photos[0]?.url ?? null,
    amenities: property.amenityIds
      .map((id) => amenities.get(id)?.name)
      .filter((name): name is string => name !== undefined),
  }
}
