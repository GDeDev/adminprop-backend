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

  /**
   * Vincula el contrato activo: la propiedad pasa a alquilada y el contrato
   * queda también como el último que tuvo. Lo llama sólo la facade.
   */
  abstract attachContract(id: string, contractId: string): Promise<Property>

  /** Desvincula el contrato activo: la propiedad vuelve a disponible. */
  abstract detachContract(id: string): Promise<Property>

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

  /**
   * Cantidad de propiedades (no borradas) de cada propietario, y cuántas de
   * ellas tienen contrato activo.
   */
  abstract countByOwners(
    ownerIds: string[],
  ): Promise<{ ownerId: string; total: number; active: number }[]>

  /** Las propiedades de un propietario, por dirección. Con la foto principal. */
  abstract listByOwner(ownerId: string): Promise<Property[]>

  /** Dirección de cada una, en una consulta. Las borradas no aparecen. */
  abstract findByIds(ids: string[]): Promise<Property[]>
}

/**
 * Lo que las reglas de propiedades necesitan saber de los contratos. El
 * módulo de contratos no se importa (sería un ciclo: él depende de
 * propiedades); se lee el vínculo que ese módulo deja en la propia fila por
 * la facade (D-51).
 */
export abstract class PropertyContracts {
  abstract hasActiveContract(propertyId: string): Promise<boolean>

  abstract hasContractHistory(propertyId: string): Promise<boolean>
}
