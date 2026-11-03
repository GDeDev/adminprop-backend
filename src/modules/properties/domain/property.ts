/** Estados de una propiedad (PRD 5.1). Coinciden con el enum de Prisma. */
export enum PropertyStatus {
  AVAILABLE = 'AVAILABLE',
  RENTED = 'RENTED',
  MAINTENANCE = 'MAINTENANCE',
}

/** Moneda del precio de publicación. Coincide con el enum `Currency` de Prisma. */
export enum ListingCurrency {
  ARS = 'ARS',
  USD = 'USD',
}

/** Operación con la que se publica la propiedad en el sitio web. Coincide con el enum de Prisma. */
export enum ListingOperation {
  SALE = 'SALE',
  RENT = 'RENT',
}

/** Topes de los datos de la ficha pública (sitio web de la inmobiliaria). */
export const LISTING_LIMITS = {
  /** Dormitorios, baños y ambientes. */
  count: { min: 0, max: 99 },
  /** Superficies en m². */
  area: { min: 0, max: 99_999_999 },
  ageYears: { min: 0, max: 500 },
} as const

/** Largo máximo de la descripción pública (Fase 22). */
export const MAX_PUBLIC_DESCRIPTION = 2000

/** Máximo de fotos por propiedad (spec Fase 6, 3.6). */
export const MAX_PHOTOS_PER_PROPERTY = 20

export interface PropertyPhoto {
  id: string
  url: string
  /** Para borrar el archivo del storage. Nunca sale por la API. */
  storageKey: string
  position: number
  createdAt: Date
}

export interface Property {
  id: string
  address: string
  locationId: string
  propertyTypeId: string
  status: PropertyStatus
  ownerId: string | null
  amenityIds: string[]
  notes: string | null
  /** Contrato activo (lo fija el módulo de contratos por la facade). */
  activeContractId: string | null
  /** Último contrato que tuvo, activo o no: el "historial de contratos". */
  lastContractId: string | null
  /** Precio de publicación ("150000.00"), o null = "Consultar" (Fase 22). */
  listingPrice: string | null
  listingCurrency: ListingCurrency
  /** Texto que ve el público; las `notes` internas nunca salen. */
  publicDescription: string | null
  /** Datos de la ficha pública; todos opcionales (sitio web). */
  listingOperation: ListingOperation
  bedrooms: number | null
  bathrooms: number | null
  rooms: number | null
  totalAreaM2: number | null
  coveredAreaM2: number | null
  ageYears: number | null
  latitude: number | null
  longitude: number | null
  /** Ordenadas por posición: la primera es la principal. */
  photos: PropertyPhoto[]
  createdAt: Date
  updatedAt: Date
}
