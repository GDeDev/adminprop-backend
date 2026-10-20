import { Injectable } from '@nestjs/common'

import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { IsoDate } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { ContractStatus } from '../domain/contract'
import { ContractPolicy } from '../domain/contract.policy'
import { ContractRepository } from '../domain/contract.ports'

/**
 * Lo que el cron de la Fase 13 necesita de los contratos, expuesto por
 * `ContractsFacade`. Vive en la capa de aplicación porque toca las facades
 * de propiedades e inquilinos, que un `public/` no puede importar.
 */
@Injectable()
export class ContractLifecycle {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly properties: PropertiesFacade,
    private readonly renters: RentersFacade,
    private readonly prisma: PrismaService,
  ) {}

  /** Ids de los contratos activos con un aumento pendiente a esa fecha. */
  async listDueForRentUpdate(today: IsoDate): Promise<string[]> {
    const active = await this.contracts.listActive()
    return active
      .filter((contract) => {
        const next = ContractPolicy.nextRentUpdateOn(
          contract.rentUpdates[0].effectiveFrom,
          contract.rentUpdateFrequency,
        )
        return next <= today && next <= contract.endDate
      })
      .map((contract) => contract.id)
  }

  /**
   * Marca como finalizados los contratos activos cuyo fin ya pasó y libera
   * su propiedad y su inquilino. Devuelve cuántos cerró. Idempotente: la
   * segunda vez no encuentra ninguno.
   */
  async finishExpired(today: IsoDate): Promise<number> {
    const expired = await this.contracts.listActive({ endingBefore: today })
    for (const contract of expired) {
      await this.prisma.transaction(async () => {
        await this.contracts.setStatus(contract.id, ContractStatus.FINISHED)
        await this.properties.detachContract(contract.propertyId)
        await this.renters.detachContract(contract.renterId)
      })
    }
    return expired.length
  }
}
