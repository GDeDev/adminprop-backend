/**
 * Niveles de ubicación, de lo más general a lo más específico. Los valores
 * coinciden con el enum `LocationLevel` de `prisma/schema.prisma`.
 */
export enum LocationLevel {
  COUNTRY = 'COUNTRY',
  PROVINCE = 'PROVINCE',
  CITY = 'CITY',
  NEIGHBORHOOD = 'NEIGHBORHOOD',
}

/** Orden jerárquico: un padre siempre tiene un número menor que su hijo. */
export const LEVEL_DEPTH: Record<LocationLevel, number> = {
  [LocationLevel.COUNTRY]: 0,
  [LocationLevel.PROVINCE]: 1,
  [LocationLevel.CITY]: 2,
  [LocationLevel.NEIGHBORHOOD]: 3,
}

export interface Location {
  id: string
  level: LocationLevel
  name: string
  parentId: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** Un nodo del árbol de `GET /locations/tree`. */
export interface LocationNode extends Location {
  children: LocationNode[]
}
