import { Injectable } from '@nestjs/common'

import { IsoDate, todayIso } from '@/shared/dates/calendar-date'
import { ContractLifecycle } from '../application/contract-lifecycle'
import { ContractStatus, Currency, currentRentOf } from '../domain/contract'
import { ContractRepository } from '../domain/contract.ports'

/** Lo que otro módulo necesita de un contrato activo (cobros, servicios). */
export interface ActiveContractRef {
  id: string
  propertyId: string
  ownerId: string
  renterId: string
  startDate: IsoDate
  endDate: IsoDate
  currency: Currency
  currentRent: string
  feePercentage: string
}

/** Lo mínimo de un contrato en cualquier estado (servicios, gastos adelantados). */
export interface ContractRef {
  id: string
  propertyId: string
  ownerId: string
  renterId: string
  status: ContractStatus
  currency: Currency
}

/**
 * Lo que otros módulos pueden pedirle a contratos. Dentro del tenant del
 * contexto. `listDueForRentUpdate` y `finishExpired` son para el cron de la
 * Fase 13, que los llama por inmobiliaria con `RequestContext.runInTenant`.
 */
@Injectable()
export class ContractsFacade {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly lifecycle: ContractLifecycle,
  ) {}

  async exists(id: string): Promise<boolean> {
    return (await this.contracts.findById(id)) !== null
  }

  /**
   * El contrato en cualquier estado, o null si no existe en esta
   * inmobiliaria. Un rescindido sigue existiendo: puede tener gastos
   * adelantados pendientes (spec Fase 10, 7).
   */
  async find(id: string): Promise<ContractRef | null> {
    const contract = await this.contracts.findById(id)
    return contract
      ? {
          id: contract.id,
          propertyId: contract.propertyId,
          ownerId: contract.ownerId,
          renterId: contract.renterId,
          status: contract.status,
          currency: contract.currency,
        }
      : null
  }

  async getActiveByProperty(
    propertyId: string,
  ): Promise<ActiveContractRef | null> {
    const contract = await this.contracts.findActiveByProperty(propertyId)
    return contract
      ? {
          id: contract.id,
          propertyId: contract.propertyId,
          ownerId: contract.ownerId,
          renterId: contract.renterId,
          startDate: contract.startDate,
          endDate: contract.endDate,
          currency: contract.currency,
          currentRent: currentRentOf(contract),
          feePercentage: contract.feePercentage,
        }
      : null
  }

  /** Alquiler vigente, o null si el contrato no existe. */
  async currentRent(contractId: string): Promise<string | null> {
    const contract = await this.contracts.findById(contractId)
    return contract ? currentRentOf(contract) : null
  }

  /**
   * Ids de los contratos activos con un aumento pendiente a esa fecha. Cada
   * uno se aplica con `POST /contracts/:id/rent-updates` (o su command).
   */
  listDueForRentUpdate(today: IsoDate = todayIso()): Promise<string[]> {
    return this.lifecycle.listDueForRentUpdate(today)
  }

  /**
   * Marca como finalizados los contratos activos cuyo fin ya pasó y libera
   * su propiedad y su inquilino. Devuelve cuántos cerró.
   */
  finishExpired(today: IsoDate = todayIso()): Promise<number> {
    return this.lifecycle.finishExpired(today)
  }
}
