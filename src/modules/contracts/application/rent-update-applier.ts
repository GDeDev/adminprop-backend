import { Injectable } from '@nestjs/common'
import { EventBus } from '@nestjs/cqrs'

import { IndexType, IndicesFacade } from '@/modules/indices/public'
import { RequestContext } from '@/shared/context/request-context'
import { IsoDate, periodOf } from '@/shared/dates/calendar-date'
import {
  Contract,
  currentRentOf,
  RentUpdateSource,
  RentUpdateType,
} from '../domain/contract'
import { IndexMissingException } from '../domain/contract.exceptions'
import { ContractPolicy } from '../domain/contract.policy'
import { ContractRepository, NewRentUpdate } from '../domain/contract.ports'
import { RentUpdateAppliedEvent } from './events/rent-update-applied.event'

/**
 * Cómo se escribe un aumento. Lo comparten `POST /contracts/:id/rent-updates`
 * y el cron de la Fase 13: los dos dejan la misma fila en el historial y
 * emiten el mismo evento.
 */
@Injectable()
export class RentUpdateApplier {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly indices: IndicesFacade,
    private readonly eventBus: EventBus,
  ) {}

  /** Agrega la fila al historial y avisa. `appliedById` null = el cron. */
  async record(
    contract: Contract,
    update: Omit<NewRentUpdate, 'previousRent' | 'appliedById'>,
    appliedById: string | null = RequestContext.userId ?? null,
  ): Promise<Contract> {
    const previousRent = currentRentOf(contract)
    const updated = await this.contracts.addRentUpdate(contract.id, {
      ...update,
      previousRent,
      appliedById,
    })
    this.eventBus.publish(
      new RentUpdateAppliedEvent(
        contract.id,
        update.effectiveFrom,
        previousRent,
        update.newRent,
      ),
    )
    return updated
  }

  /** Aumento por ICL/IPC; falta algún valor → `IndexMissingException`. */
  async applyIndex(
    contract: Contract,
    effectiveFrom: IsoDate,
    appliedById?: string | null,
  ): Promise<Contract> {
    const previousEffectiveFrom = contract.rentUpdates[0].effectiveFrom
    const indexType = IndexType[contract.rentUpdateType as 'ICL' | 'IPC']
    const fromPeriod = periodOf(previousEffectiveFrom)
    const toPeriod = periodOf(effectiveFrom)
    const [fromValue, toValue] = await Promise.all([
      this.indices.getValue(indexType, fromPeriod),
      this.indices.getValue(indexType, toPeriod),
    ])
    if (!fromValue) throw new IndexMissingException(indexType, fromPeriod)
    if (!toValue) throw new IndexMissingException(indexType, toPeriod)

    return this.record(
      contract,
      {
        effectiveFrom,
        newRent: ContractPolicy.indexedRent(
          currentRentOf(contract),
          fromValue,
          toValue,
        ),
        source: RentUpdateSource.INDEX,
        indexType,
        indexFromPeriod: fromPeriod,
        indexToPeriod: toPeriod,
        indexFromValue: fromValue,
        indexToValue: toValue,
        fixedPercentage: null,
      },
      appliedById,
    )
  }

  /** Aumento fijo: el % del contrato aplicado solo, sin monto a mano. */
  applyFixedPercentage(
    contract: Contract,
    effectiveFrom: IsoDate,
    percentage: string,
    appliedById?: string | null,
  ): Promise<Contract> {
    return this.record(
      contract,
      {
        effectiveFrom,
        newRent: ContractPolicy.fixedIncreaseRent(
          currentRentOf(contract),
          percentage,
        ),
        source: RentUpdateSource.MANUAL,
        indexType: null,
        indexFromPeriod: null,
        indexToPeriod: null,
        indexFromValue: null,
        indexToValue: null,
        fixedPercentage: percentage,
      },
      appliedById,
    )
  }

  /** Lo que pide aplicar el cron para este contrato, sin tirar si no se puede. */
  static isIndexed(contract: Contract): boolean {
    return (
      contract.rentUpdateType === RentUpdateType.ICL ||
      contract.rentUpdateType === RentUpdateType.IPC
    )
  }
}
