import { Property, PropertyPhoto, PropertyStatus } from './property'

export interface PropertyData {
  address: string
  locationId: string
  propertyTypeId: string
  ownerId: string | null
  amenityIds: string[]
  notes: string | null
}

export interface PropertyFilter {
  status?: PropertyStatus
  ownerId?: string
  propertyTypeId?: string
  /** Parte de la dirección, sin distinguir mayúsculas. */
  search?: string
}

/**
 * Puerto del repositorio. Todo corre dentro del tenant del contexto; los
 * borrados lógicos no aparecen nunca.
 */
export abstract class PropertyRepository {
  abstract create(data: PropertyData): Promise<Property>

  abstract findById(id: string): Promise<Property | null>

  /** Más nuevas primero. Trae sólo la foto principal de cada una. */
  abstract list(
    filter: PropertyFilter,
    page: { skip: number; take: number },
  ): Promise<[Property[], number]>

  abstract update(id: string, data: Partial<PropertyData>): Promise<Property>

  abstract setStatus(id: string, status: PropertyStatus): Promise<Property>

  abstract softDelete(id: string): Promise<void>

  /**
   * Agrega las fotos al final, en una transacción: o quedan todas o ninguna
   * (spec, casos borde).
   */
  abstract addPhotos(
    propertyId: string,
    photos: { storageKey: string; url: string }[],
  ): Promise<PropertyPhoto[]>

  abstract deletePhoto(propertyId: string, photoId: string): Promise<void>
}

/**
 * Lo que las reglas de propiedades necesitan saber de los contratos (Fase 9).
 * Hasta que existan, la implementación responde que no hay ninguno; la Fase
 * 9 la reemplaza por una que le pregunta al módulo de contratos, sin tocar
 * las reglas.
 */
export abstract class PropertyContracts {
  abstract hasActiveContract(propertyId: string): Promise<boolean>

  abstract hasContractHistory(propertyId: string): Promise<boolean>
}
