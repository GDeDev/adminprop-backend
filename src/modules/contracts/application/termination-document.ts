import { Injectable } from '@nestjs/common'

import { OwnersFacade } from '@/modules/owners/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { IsoDate } from '@/shared/dates/calendar-date'
import {
  ContractStatus,
  Currency,
  currentRentOf,
  DepositReturnMode,
} from '../domain/contract'
import { ContractRepository } from '../domain/contract.ports'
import {
  ContractPolicy,
  TERMINATION_PENALTY_PERCENT,
} from '../domain/contract.policy'

/** Todo lo que lleva el cálculo de la rescisión, con nombres resueltos (Fase 15). */
export interface TerminationDocumentData {
  contractId: string
  status: ContractStatus
  startDate: IsoDate
  endDate: IsoDate
  currency: Currency
  property: { id: string; address: string } | null
  owner: { id: string; fullName: string; nationalId: string } | null
  renter: { id: string; fullName: string; nationalId: string } | null
  notifiedAt: IsoDate
  terminatedAt: IsoDate
  currentRent: string
  remainingMonths: number
  remainingDays: number
  totalDays: number
  futureRent: string
  /** El % fijo de RN-09, para mostrarlo en el cálculo. */
  penaltyPercent: string
  penalty: string
  deposit: string
  depositCurrency: Currency
  depositReturnMode: DepositReturnMode
}

/** Arma los datos del PDF de rescisión a partir del contrato ya rescindido. */
@Injectable()
export class TerminationDocuments {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly properties: PropertiesFacade,
    private readonly owners: OwnersFacade,
    private readonly renters: RentersFacade,
  ) {}

  /** Null si el contrato no existe o no está rescindido. */
  async dataFor(contractId: string): Promise<TerminationDocumentData | null> {
    const contract = await this.contracts.findById(contractId)
    if (!contract?.termination) return null
    const { termination } = contract
    const breakdown = ContractPolicy.termination(
      currentRentOf(contract),
      termination.notifiedAt,
      contract.endDate,
    )
    const [properties, owners, renters] = await Promise.all([
      this.properties.describe([contract.propertyId]),
      this.owners.contacts([contract.ownerId]),
      this.renters.contacts([contract.renterId]),
    ])
    const owner = owners.get(contract.ownerId)
    const renter = renters.get(contract.renterId)
    const property = properties.get(contract.propertyId)
    return {
      contractId: contract.id,
      status: contract.status,
      startDate: contract.startDate,
      endDate: contract.endDate,
      currency: contract.currency,
      property: property
        ? { id: property.id, address: property.address }
        : null,
      owner: owner
        ? {
            id: owner.id,
            fullName: owner.fullName,
            nationalId: owner.nationalId,
          }
        : null,
      renter: renter
        ? {
            id: renter.id,
            fullName: renter.fullName,
            nationalId: renter.nationalId,
          }
        : null,
      notifiedAt: termination.notifiedAt,
      terminatedAt: termination.terminatedAt,
      currentRent: breakdown.currentRent,
      remainingMonths: breakdown.remainingMonths,
      remainingDays: breakdown.remainingDays,
      totalDays: breakdown.totalDays,
      // Lo que quedó registrado manda sobre el recálculo.
      futureRent: termination.futureRent,
      penaltyPercent: TERMINATION_PENALTY_PERCENT,
      penalty: termination.penalty,
      deposit: contract.deposit,
      depositCurrency: contract.depositCurrency,
      depositReturnMode: contract.depositReturnMode,
    }
  }
}
