/** Estados de una propiedad (PRD 5.1). Coinciden con el enum de Prisma. */
export enum PropertyStatus {
  AVAILABLE = 'AVAILABLE',
  RENTED = 'RENTED',
  MAINTENANCE = 'MAINTENANCE',
}

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
  /** Ordenadas por posición: la primera es la principal. */
  photos: PropertyPhoto[]
  createdAt: Date
  updatedAt: Date
}
