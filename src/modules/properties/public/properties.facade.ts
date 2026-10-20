import { Injectable } from '@nestjs/common'

import { PropertyStatus } from '../domain/property'
import { PropertyRepository } from '../domain/property.ports'

export { PropertyStatus }

export interface OwnerPortfolio {
  /** Todas sus propiedades no borradas. */
  total: number
  /**
   * Las que cuentan como "activas" para el honorario reducido (RN-07): las
   * que tienen un contrato activo. Una alquilada a mano, sin contrato, no
   * cuenta (D-39, cerrada en la Fase 9).
   */
  active: number
}

export interface OwnerPropertySummary {
  id: string
  address: string
  status: PropertyStatus
  mainPhotoUrl: string | null
}

/** Lo justo para mostrar una propiedad desde otro módulo. */
export interface PropertyRef {
  id: string
  address: string
}

/** Lo que un contrato necesita saber de la propiedad al armarse. */
export interface PropertyContractInfo extends PropertyRef {
  status: PropertyStatus
  ownerId: string | null
  activeContractId: string | null
}

/**
 * Lo que otros módulos pueden preguntarle a propiedades. Dentro del tenant
 * del contexto: un id de otra inmobiliaria es un id que no existe.
 *
 * `attachContract` y `detachContract` son el único camino por el que una
 * propiedad se entera de sus contratos: el módulo de contratos los llama
 * dentro de su transacción, y propiedades nunca importa a contratos (D-51).
 */
@Injectable()
export class PropertiesFacade {
  constructor(private readonly properties: PropertyRepository) {}

  async find(id: string): Promise<PropertyContractInfo | null> {
    const property = await this.properties.findById(id)
    return property
      ? {
          id: property.id,
          address: property.address,
          status: property.status,
          ownerId: property.ownerId,
          activeContractId: property.activeContractId,
        }
      : null
  }

  /** Dirección de cada una, en una sola consulta. Las borradas no aparecen. */
  async describe(ids: string[]): Promise<Map<string, PropertyRef>> {
    const properties = await this.properties.findByIds([...new Set(ids)])
    return new Map(
      properties.map((property) => [
        property.id,
        { id: property.id, address: property.address },
      ]),
    )
  }

  async portfolios(ownerIds: string[]): Promise<Map<string, OwnerPortfolio>> {
    const counts = await this.properties.countByOwners([...new Set(ownerIds)])
    const result = new Map<string, OwnerPortfolio>(
      ownerIds.map((id) => [id, { total: 0, active: 0 }]),
    )
    for (const { ownerId, total, active } of counts) {
      result.set(ownerId, { total, active })
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

  /** La propiedad pasa a alquilada con ese contrato como activo. */
  async attachContract(propertyId: string, contractId: string): Promise<void> {
    await this.properties.attachContract(propertyId, contractId)
  }

  /** La propiedad vuelve a disponible, sin contrato activo. */
  async detachContract(propertyId: string): Promise<void> {
    await this.properties.detachContract(propertyId)
  }
}
