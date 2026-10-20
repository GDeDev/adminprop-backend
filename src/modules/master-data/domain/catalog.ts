/**
 * Los maestros "planos" (una lista de nombres): todos se comportan igual, y
 * por eso comparten casos de uso, repositorio y controller base. Las
 * ubicaciones son jerárquicas y tienen lo suyo (`location.*`).
 *
 * El valor es el segmento de la URL: `/api/v1/property-types`.
 */
export enum Catalog {
  PROPERTY_TYPES = 'property-types',
  AMENITIES = 'amenities',
  OPERATION_TYPES = 'operation-types',
  SERVICE_TYPES = 'service-types',
}

/** Un ítem de un maestro plano. */
export interface CatalogItem {
  id: string
  name: string
  /** Sólo amenities: nombre de ícono de lucide. En el resto, siempre null. */
  icon: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** Qué ítems listar. Por defecto (spec 3) sólo los activos: los de los selectores. */
export type ActiveFilter = 'active' | 'inactive' | 'all'

export const CATALOG_LABELS: Record<Catalog, string> = {
  [Catalog.PROPERTY_TYPES]: 'tipo de propiedad',
  [Catalog.AMENITIES]: 'amenity',
  [Catalog.OPERATION_TYPES]: 'tipo de operación',
  [Catalog.SERVICE_TYPES]: 'tipo de servicio',
}
