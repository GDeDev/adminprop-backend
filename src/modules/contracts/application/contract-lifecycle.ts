import { Injectable } from '@nestjs/common'

import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { daysBetween, IsoDate } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  ContractStatus,
  currentRentOf,
  RentUpdateType,
} from '../domain/contract'
import { IndexMissingException } from '../domain/contract.exceptions'
import { ContractPolicy } from '../domain/contract.policy'
import { ContractRepository } from '../domain/contract.ports'
import { RentUpdateApplier } from './rent-update-applier'

/** Qué pasó al intentar aplicar el aumento que tocaba (Fase 13, 2). */
export type RentUpdateOutcome =
  | {
      status: 'APPLIED'
      contractId: string
      effectiveFrom: IsoDate
      previousRent: string
      newRent: string
      source: 'INDEX' | 'FIXED_PERCENTAGE'
    }
  | {
      status: 'MANUAL_REQUIRED'
      contractId: string
      effectiveFrom: IsoDate
      /** Por qué no se pudo solo. */
      reason: 'MISSING_INDEX' | 'MANUAL_AMOUNT'
      rentUpdateType: RentUpdateType
      /** Con `MISSING_INDEX`, el mes del índice que falta. */
      missingPeriod: string | null
    }
  | { status: 'NOT_DUE'; contractId: string }

/** Un contrato por vencer, para el aviso de la Fase 13. */
export interface ExpiringContract {
  id: string
  propertyId: string
  ownerId: string
  renterId: string
  endDate: IsoDate
  daysLeft: number
}

/** Un contrato activo con caución, para las alertas de póliza y a la aseguradora. */
export interface SuretyContract {
  id: string
  propertyId: string
  ownerId: string
  renterId: string
  insurerName: string | null
  insurerAlertEmail: string | null
  policyNumber: string | null
  policyExpiresAt: IsoDate | null
}

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
    private readonly applier: RentUpdateApplier,
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
   * Aplica el aumento que toca a ese contrato, si toca (Fase 13). A diferencia
   * del endpoint, no tira cuando no se puede: dice por qué, para que el job
   * avise a una persona. Un solo aumento por llamada; si hay varios
   * atrasados, el job vuelve a llamar. Con ICL/IPC usa los índices cargados;
   * con FIXED y porcentaje, lo aplica; el resto es manual. `appliedById` queda
   * en null (lo aplicó el sistema).
   */
  async applyDueRentUpdate(
    contractId: string,
    today: IsoDate,
  ): Promise<RentUpdateOutcome> {
    const contract = await this.contracts.findById(contractId)
    if (!contract || contract.status !== ContractStatus.ACTIVE) {
      return { status: 'NOT_DUE', contractId }
    }
    const latest = contract.rentUpdates[0]
    const effectiveFrom = ContractPolicy.nextRentUpdateOn(
      latest.effectiveFrom,
      contract.rentUpdateFrequency,
    )
    if (effectiveFrom > contract.endDate || effectiveFrom > today) {
      return { status: 'NOT_DUE', contractId }
    }

    const previousRent = currentRentOf(contract)
    if (RentUpdateApplier.isIndexed(contract)) {
      try {
        const updated = await this.applier.applyIndex(
          contract,
          effectiveFrom,
          null,
        )
        return {
          status: 'APPLIED',
          contractId,
          effectiveFrom,
          previousRent,
          newRent: currentRentOf(updated),
          source: 'INDEX',
        }
      } catch (error) {
        if (!(error instanceof IndexMissingException)) throw error
        return {
          status: 'MANUAL_REQUIRED',
          contractId,
          effectiveFrom,
          reason: 'MISSING_INDEX',
          rentUpdateType: contract.rentUpdateType,
          missingPeriod: String(error.metadata?.period ?? '') || null,
        }
      }
    }
    if (
      contract.rentUpdateType === RentUpdateType.FIXED &&
      contract.fixedIncreasePercentage !== null
    ) {
      const updated = await this.applier.applyFixedPercentage(
        contract,
        effectiveFrom,
        contract.fixedIncreasePercentage,
        null,
      )
      return {
        status: 'APPLIED',
        contractId,
        effectiveFrom,
        previousRent,
        newRent: currentRentOf(updated),
        source: 'FIXED_PERCENTAGE',
      }
    }
    return {
      status: 'MANUAL_REQUIRED',
      contractId,
      effectiveFrom,
      reason: 'MANUAL_AMOUNT',
      rentUpdateType: contract.rentUpdateType,
      missingPeriod: null,
    }
  }

  /** Activos cuyo fin cae dentro de los próximos `days` días (hoy incluido). */
  async listExpiringWithin(
    days: number,
    today: IsoDate,
  ): Promise<ExpiringContract[]> {
    const active = await this.contracts.listActive()
    return active
      .map((contract) => ({
        id: contract.id,
        propertyId: contract.propertyId,
        ownerId: contract.ownerId,
        renterId: contract.renterId,
        endDate: contract.endDate,
        daysLeft: daysBetween(today, contract.endDate),
      }))
      .filter((c) => c.daysLeft >= 0 && c.daysLeft <= days)
      .sort((a, b) => a.daysLeft - b.daysLeft)
  }

  /** Activos con caución cargada. */
  async listWithSurety(): Promise<SuretyContract[]> {
    const active = await this.contracts.listActive()
    return active
      .filter((contract) => contract.surety.hasSurety)
      .map((contract) => ({
        id: contract.id,
        propertyId: contract.propertyId,
        ownerId: contract.ownerId,
        renterId: contract.renterId,
        insurerName: contract.surety.insurerName,
        insurerAlertEmail: contract.surety.insurerAlertEmail,
        policyNumber: contract.surety.policyNumber,
        policyExpiresAt: contract.surety.policyExpiresAt,
      }))
  }

  /** Qué índices usan hoy los contratos activos (para avisar sólo a quien le importa). */
  async indexTypesInUse(): Promise<('ICL' | 'IPC')[]> {
    const active = await this.contracts.listActive()
    const types = new Set<'ICL' | 'IPC'>()
    for (const contract of active) {
      if (contract.rentUpdateType === RentUpdateType.ICL) types.add('ICL')
      if (contract.rentUpdateType === RentUpdateType.IPC) types.add('IPC')
    }
    return [...types]
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
