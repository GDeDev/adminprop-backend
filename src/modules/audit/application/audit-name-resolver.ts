import { Injectable } from '@nestjs/common'

import { UsersFacade } from '@/modules/auth/public'
import { ContractsFacade } from '@/modules/contracts/public'
import { OwnersFacade } from '@/modules/owners/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'

export interface EntityRef {
  entity: string
  id: string
}

export const refKey = (entity: string, id: string) => `${entity}:${id}`

/** Campo que guarda el id de otra entidad -> qué entidad es. */
export const REFERENCE_FIELDS: Record<string, string> = {
  propertyId: 'Property',
  ownerId: 'Owner',
  renterId: 'Renter',
  contractId: 'Contract',
  userId: 'User',
  registeredById: 'User',
  confirmedById: 'User',
  voidedById: 'User',
  cancelledById: 'User',
  closedById: 'User',
  createdById: 'User',
  updatedById: 'User',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/**
 * Convierte ids en nombres legibles para el historial (Fase 20, 5). Sólo
 * consulta las facades de los módulos dueños (`describe`/`find`), en lote y
 * dentro del tenant del contexto; lo que no encuentra (borrado, de otra
 * inmobiliaria) simplemente no figura.
 */
@Injectable()
export class AuditNameResolver {
  constructor(
    private readonly properties: PropertiesFacade,
    private readonly owners: OwnersFacade,
    private readonly renters: RentersFacade,
    private readonly contracts: ContractsFacade,
    private readonly users: UsersFacade,
  ) {}

  async resolve(refs: EntityRef[]): Promise<Map<string, string>> {
    const idsOf = (entity: string) => [
      ...new Set(refs.filter((r) => r.entity === entity).map((r) => r.id)),
    ]
    const names = new Map<string, string>()

    // Los contratos se nombran por propiedad e inquilino: se leen primero.
    const contracts = await Promise.all(
      idsOf('Contract').map((id) => this.contracts.find(id)),
    )
    const found = contracts.filter((c) => c !== null)

    const [properties, owners, renters, users] = await Promise.all([
      this.properties.describe([
        ...idsOf('Property'),
        ...found.map((c) => c.propertyId),
      ]),
      this.owners.describe(idsOf('Owner')),
      this.renters.describe([
        ...idsOf('Renter'),
        ...found.map((c) => c.renterId),
      ]),
      this.users.describe(idsOf('User')),
    ])

    for (const [id, ref] of properties) {
      names.set(refKey('Property', id), ref.address)
    }
    for (const [id, ref] of owners) {
      names.set(refKey('Owner', id), ref.fullName)
    }
    for (const [id, ref] of renters) {
      names.set(refKey('Renter', id), ref.fullName)
    }
    for (const [id, ref] of users) {
      names.set(refKey('User', id), ref.fullName)
    }
    for (const contract of found) {
      const address = properties.get(contract.propertyId)?.address
      const renter = renters.get(contract.renterId)?.fullName
      const label = [address, renter].filter(Boolean).join(' - ')
      if (label) names.set(refKey('Contract', contract.id), label)
    }
    return names
  }
}
