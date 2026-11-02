import { Injectable } from '@nestjs/common'

import {
  firstDayOfPeriod,
  IsoDate,
  lastDayOfPeriod,
  Period,
  todayIso,
} from '@/shared/dates/calendar-date'
import { BillingTermsResolver } from '../application/billing-terms-resolver'
import {
  ContractLifecycle,
  ExpiringContract,
  RentUpdateOutcome,
  SuretyContract,
} from '../application/contract-lifecycle'
import {
  Contract,
  ContractStatus,
  Currency,
  currentRentOf,
  DepositReturnMode,
  LateFeeDefaults,
  ResolvedBillingTerms,
} from '../domain/contract'
import { ContractRepository } from '../domain/contract.ports'
import {
  TerminationDocumentData,
  TerminationDocuments,
} from '../application/termination-document'

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
  /** El % vigente (igual a `billingTerms.feePercentage`). */
  feePercentage: string
  deposit: string
  depositCurrency: Currency
  depositReturnMode: DepositReturnMode
  /** Vigentes a la fecha pedida, con el punitorio del tenant ya resuelto. */
  billingTerms: ResolvedBillingTerms
}

/** Lo mínimo de un contrato en cualquier estado (servicios, gastos, cobros). */
export interface ContractRef {
  id: string
  propertyId: string
  ownerId: string
  renterId: string
  status: ContractStatus
  currency: Currency
  startDate: IsoDate
  endDate: IsoDate
  currentRent: string
  deposit: string
  depositCurrency: Currency
  depositReturnMode: DepositReturnMode
  /** Vigentes hoy, resueltos. */
  billingTerms: ResolvedBillingTerms
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
    private readonly billingTerms: BillingTermsResolver,
    private readonly terminationDocuments: TerminationDocuments,
  ) {}

  /** Todo lo que lleva el PDF de la rescisión; null si no está rescindido (Fase 15). */
  terminationForPdf(
    contractId: string,
  ): Promise<TerminationDocumentData | null> {
    return this.terminationDocuments.dataFor(contractId)
  }

  /** Guarda el PDF del cálculo de la rescisión en el contrato (Fase 15). */
  attachTerminationDocument(
    contractId: string,
    file: { key: string; url: string },
  ): Promise<void> {
    return this.contracts.attachTerminationPdf(contractId, file)
  }

  /** Inquilino y propietario del contrato, para autorizar descargas (Fase 15). */
  async parties(
    contractId: string,
  ): Promise<{ renterId: string; ownerId: string } | null> {
    const contract = await this.contracts.findById(contractId)
    return contract
      ? { renterId: contract.renterId, ownerId: contract.ownerId }
      : null
  }

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
    if (!contract) return null
    return {
      id: contract.id,
      propertyId: contract.propertyId,
      ownerId: contract.ownerId,
      renterId: contract.renterId,
      status: contract.status,
      currency: contract.currency,
      startDate: contract.startDate,
      endDate: contract.endDate,
      currentRent: currentRentOf(contract),
      deposit: contract.deposit,
      depositCurrency: contract.depositCurrency,
      depositReturnMode: contract.depositReturnMode,
      billingTerms: await this.billingTerms.inForce(contract, todayIso()),
    }
  }

  async getActiveByProperty(
    propertyId: string,
  ): Promise<ActiveContractRef | null> {
    const contract = await this.contracts.findActiveByProperty(propertyId)
    if (!contract) return null
    const today = todayIso()
    return toActiveRef(
      contract,
      this.billingTerms.resolve(
        contract,
        today,
        await this.billingTerms.defaults(),
      ),
    )
  }

  /**
   * Los contratos activos que cubren algún día del mes `AAAA-MM`, con su
   * alquiler vigente hoy y los términos vigentes al primer día del mes (o al
   * inicio del contrato si empieza después). Cobros (Fase 11) genera una
   * cuota por cada uno; un contrato que empieza o termina a mitad de mes
   * entra igual (A-7).
   */
  async listActiveForPeriod(period: Period): Promise<ActiveContractRef[]> {
    const firstDay = firstDayOfPeriod(period)
    const [contracts, defaults] = await Promise.all([
      this.contracts.listActiveCovering(firstDay, lastDayOfPeriod(period)),
      this.billingTerms.defaults(),
    ])
    return contracts.map((contract) =>
      toActiveRef(
        contract,
        this.billingTerms.resolve(
          contract,
          contract.startDate > firstDay ? contract.startDate : firstDay,
          defaults,
        ),
      ),
    )
  }

  /**
   * El historial del alquiler, del más reciente al más viejo, o null si el
   * contrato no existe. Cobros lo usa para saber qué base le corresponde a
   * cada cuota sin depender del orden en que llegan los eventos de aumento.
   */
  async rentHistory(
    contractId: string,
  ): Promise<{ effectiveFrom: IsoDate; newRent: string }[] | null> {
    const contract = await this.contracts.findById(contractId)
    return contract
      ? contract.rentUpdates.map(({ effectiveFrom, newRent }) => ({
          effectiveFrom,
          newRent,
        }))
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

  /** Aplica el aumento que toca a un contrato, o dice por qué no pudo (Fase 13). */
  applyDueRentUpdate(
    contractId: string,
    today: IsoDate = todayIso(),
  ): Promise<RentUpdateOutcome> {
    return this.lifecycle.applyDueRentUpdate(contractId, today)
  }

  /** Contratos activos que terminan dentro de `days` días, los más próximos primero. */
  listExpiringWithin(
    days: number,
    today: IsoDate = todayIso(),
  ): Promise<ExpiringContract[]> {
    return this.lifecycle.listExpiringWithin(days, today)
  }

  /** Contratos activos con caución cargada (póliza y aseguradora). */
  listWithSurety(): Promise<SuretyContract[]> {
    return this.lifecycle.listWithSurety()
  }

  /** Índices (ICL/IPC) que usan hoy los contratos activos. */
  indexTypesInUse(): Promise<('ICL' | 'IPC')[]> {
    return this.lifecycle.indexTypesInUse()
  }

  /**
   * Marca como finalizados los contratos activos cuyo fin ya pasó y libera
   * su propiedad y su inquilino. Devuelve cuántos cerró.
   */
  finishExpired(today: IsoDate = todayIso()): Promise<number> {
    return this.lifecycle.finishExpired(today)
  }
}

function toActiveRef(
  contract: Contract,
  billingTerms: ResolvedBillingTerms,
): ActiveContractRef {
  return {
    id: contract.id,
    propertyId: contract.propertyId,
    ownerId: contract.ownerId,
    renterId: contract.renterId,
    startDate: contract.startDate,
    endDate: contract.endDate,
    currency: contract.currency,
    currentRent: currentRentOf(contract),
    feePercentage: billingTerms.feePercentage,
    deposit: contract.deposit,
    depositCurrency: contract.depositCurrency,
    depositReturnMode: contract.depositReturnMode,
    billingTerms,
  }
}

export type {
  ExpiringContract,
  LateFeeDefaults,
  RentUpdateOutcome,
  SuretyContract,
}
