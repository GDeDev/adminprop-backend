import { Injectable } from '@nestjs/common'

import { fullNameOf } from '../domain/owner'
import { OwnerRef, OwnerRepository } from '../domain/owner.ports'

export type { OwnerRef }

/**
 * Lo que otros módulos pueden preguntarle a propietarios. Dentro del tenant
 * del contexto: un id de otra inmobiliaria es un id que no existe.
 */
@Injectable()
export class OwnersFacade {
  constructor(private readonly owners: OwnerRepository) {}

  async exists(id: string): Promise<boolean> {
    return (await this.owners.findById(id)) !== null
  }

  /** Nombre de cada uno, en una sola consulta. Los borrados no aparecen. */
  async describe(ids: string[]): Promise<Map<string, OwnerRef>> {
    const owners = await this.owners.findByIds([...new Set(ids)])
    return new Map(
      owners.map((owner) => [
        owner.id,
        { id: owner.id, fullName: fullNameOf(owner) },
      ]),
    )
  }
}
