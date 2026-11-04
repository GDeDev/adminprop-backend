import { Injectable } from '@nestjs/common'

import {
  AmenityRef,
  Catalog,
  LocationLevel,
  LocationRef,
  MasterDataFacade,
  MasterDataRef,
} from '@/modules/master-data/public'
import { ListingOperation, Property } from '../domain/property'

/** Una propiedad en el listado del portal público (Fase 22, contrato `PublicPropertySummary`). */
export interface PublicPropertySummaryView {
  id: string
  /** Dirección corta: lo que va antes de la primera coma. */
  title: string
  address: string
  propertyType: string
  neighborhood: string | null
  bedrooms: number | null
  bathrooms: number | null
  /** Superficie total. */
  areaM2: number | null
  /** Campos opcionales del sitio web (se suman, no cambian la forma anterior). */
  operation: ListingOperation
  rooms: number | null
  coveredAreaM2: number | null
  ageYears: number | null
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
        ...featuresOf(property),
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
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    areaM2: property.totalAreaM2,
    operation: property.listingOperation,
    rooms: property.rooms,
    coveredAreaM2: property.coveredAreaM2,
    ageYears: property.ageYears,
    // Sin precio es "Consultar": tampoco se manda la moneda.
    price: property.listingPrice,
    currency: property.listingPrice ? property.listingCurrency : null,
    coverPhotoUrl: property.photos[0]?.url ?? null,
    amenities: property.amenityIds
      .map((id) => amenities.get(id)?.name)
      .filter((name): name is string => name !== undefined),
  }
}

const m2 = (value: number) => `${String(value).replace('.', ',')} m²`

/** Datos de la ficha que la propiedad cargó, en el orden en que se muestran. */
function featuresOf(property: Property): { label: string; value: string }[] {
  const { totalAreaM2: total, coveredAreaM2: covered } = property
  const features: { label: string; value: string }[] = []
  if (property.rooms !== null)
    features.push({ label: 'Ambientes', value: String(property.rooms) })
  if (property.bedrooms !== null)
    features.push({ label: 'Dormitorios', value: String(property.bedrooms) })
  if (property.bathrooms !== null)
    features.push({ label: 'Baños', value: String(property.bathrooms) })
  if (total !== null)
    features.push({ label: 'Superficie total', value: m2(total) })
  if (covered !== null)
    features.push({ label: 'Superficie cubierta', value: m2(covered) })
  if (total !== null && covered !== null && total > covered)
    features.push({
      label: 'Superficie descubierta',
      value: m2(Math.round((total - covered) * 100) / 100),
    })
  if (property.ageYears !== null)
    features.push({
      label: 'Antigüedad',
      value:
        property.ageYears === 0 ? 'A estrenar' : `${property.ageYears} años`,
    })
  return features
}
