import { Injectable } from '@nestjs/common'

import { fullNameOf } from '@/shared/people/person-policy'
import { RenterRef, RenterRepository } from '../domain/renter.ports'

export type { RenterRef }

/**
 * Lo que otros módulos pueden preguntarle a inquilinos (la Fase 9 lo usa al
 * armar contratos). Dentro del tenant del contexto: un id de otra
 * inmobiliaria es un id que no existe.
 */
@Injectable()
export class RentersFacade {
  constructor(private readonly renters: RenterRepository) {}

  async exists(id: string): Promise<boolean> {
    return (await this.renters.findById(id)) !== null
  }

  /** Nombre de cada uno, en una sola consulta. Los borrados no aparecen. */
  async describe(ids: string[]): Promise<Map<string, RenterRef>> {
    const renters = await this.renters.findByIds([...new Set(ids)])
    return new Map(
      renters.map((renter) => [
        renter.id,
        { id: renter.id, fullName: fullNameOf(renter) },
      ]),
    )
  }
}
