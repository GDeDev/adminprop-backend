import { Injectable } from '@nestjs/common'

import { PropertyStatus } from '../domain/property'
import { PropertyRepository } from '../domain/property.ports'

export { PropertyStatus }

export interface OwnerPortfolio {
  /** Todas sus propiedades no borradas. */
  total: number
  /**
   * Las que cuentan como "activas" para el honorario reducido (RN-07).
   * Hasta que existan los contratos (Fase 9), las alquiladas. La Fase 9 lo
   * cambia por "con contrato activo" acá, sin tocar a quien pregunta.
   */
  active: number
}

export interface OwnerPropertySummary {
  id: string
  address: string
  status: PropertyStatus
  mainPhotoUrl: string | null
}

/**
 * Lo que otros módulos pueden preguntarle a propiedades. Dentro del tenant
 * del contexto.
 */
@Injectable()
export class PropertiesFacade {
  constructor(private readonly properties: PropertyRepository) {}

  async portfolios(ownerIds: string[]): Promise<Map<string, OwnerPortfolio>> {
    const counts = await this.properties.countByOwners([...new Set(ownerIds)])
    const result = new Map<string, OwnerPortfolio>(
      ownerIds.map((id) => [id, { total: 0, active: 0 }]),
    )
    for (const { ownerId, status, count } of counts) {
      const portfolio = result.get(ownerId) ?? { total: 0, active: 0 }
      portfolio.total += count
      if (status === PropertyStatus.RENTED) portfolio.active += count
      result.set(ownerId, portfolio)
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
}
