import { Injectable } from '@nestjs/common'

import { OwnerRef, OwnersFacade } from '@/modules/owners/public'
import { PropertiesFacade, PropertyRef } from '@/modules/properties/public'
import {
  GuarantorRef,
  RenterRef,
  RentersFacade,
} from '@/modules/renters/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { IsoDate, todayIso } from '@/shared/dates/calendar-date'
import {
  Contract,
  ContractStatus,
  Currency,
  currentRentOf,
  RentIndex,
  RentUpdateFrequency,
  RentUpdateSource,
  RentUpdateType,
} from '../domain/contract'
import { ContractPolicy, Timeline } from '../domain/contract.policy'

/** Una fila del listado (spec 3.2, 5.1). Montos como string decimal. */
export interface ContractSummaryView {
  id: string
  /** Null sólo si la propiedad se borró de la base (no debería pasar). */
  property: PropertyRef | null
  owner: OwnerRef | null
  renter: RenterRef | null
  startDate: IsoDate
  endDate: IsoDate
  currency: Currency
  /** El alquiler vigente: la última fila del historial. */
  currentRent: string
  status: ContractStatus
  hasSurety: boolean
  policyExpiresAt: IsoDate | null
  /** RN-16: hay caución y la póliza venció. */
  suretyExpired: boolean
  /** RN-12: activo y vence dentro de los días de aviso de la inmobiliaria. */
  expiringSoon: boolean
  /** Activo y con el fin ya pasado, sin renovar. */
  expired: boolean
  feePercentage: string
  createdAt: Date
  updatedAt: Date
}

export interface ContractSuretyView {
  insurerName: string | null
  insurerAlertEmail: string | null
  policyNumber: string | null
  policyExpiresAt: IsoDate | null
  policyPdfUrl: string | null
  suretyExpired: boolean
}

export interface ContractTerminationView {
  terminatedAt: IsoDate
  notifiedAt: IsoDate
  penalty: string
  futureRent: string
}

export interface ContractRentUpdateView {
  id: string
  effectiveFrom: IsoDate
  previousRent: string | null
  newRent: string
  source: RentUpdateSource
  indexType: RentIndex | null
  indexFromPeriod: string | null
  indexToPeriod: string | null
  indexFromValue: string | null
  indexToValue: string | null
  appliedById: string | null
  createdAt: Date
}

/** La ficha (spec 3.3). */
export interface ContractDetailView extends ContractSummaryView {
  guarantor: GuarantorRef | null
  initialRent: string
  deposit: string
  rentUpdateType: RentUpdateType
  rentUpdateFrequency: RentUpdateFrequency
  notes: string | null
  contractPdfUrl: string | null
  /** Null si el contrato no tiene caución. */
  surety: ContractSuretyView | null
  termination: ContractTerminationView | null
  renewedFromId: string | null
  /** Del más reciente al más viejo. */
  rentUpdates: ContractRentUpdateView[]
  /** Null si no está activo o si termina antes del próximo aumento. */
  nextRentUpdateOn: IsoDate | null
  timeline: Timeline
  /** Siempre vacío hasta el motor de cobros (Fase 11). */
  monthlyStatus: never[]
}

interface Parties {
  properties: Map<string, PropertyRef>
  owners: Map<string, OwnerRef>
  renters: Map<string, RenterRef>
}

/**
 * Arma las vistas resolviendo propiedades, propietarios e inquilinos de toda
 * la página en una consulta por módulo. Las marcas derivadas (por vencer,
 * vencido, póliza vencida) se calculan al momento, nunca se guardan.
 */
@Injectable()
export class ContractViews {
  constructor(
    private readonly properties: PropertiesFacade,
    private readonly owners: OwnersFacade,
    private readonly renters: RentersFacade,
    private readonly tenants: TenantsFacade,
  ) {}

  async summaries(contracts: Contract[]): Promise<ContractSummaryView[]> {
    if (contracts.length === 0) return []
    const [parties, noticeDays] = await Promise.all([
      this.describeParties(contracts),
      this.noticeDays(),
    ])
    const today = todayIso()
    return contracts.map((contract) =>
      toSummary(contract, parties, today, noticeDays),
    )
  }

  async detail(contract: Contract): Promise<ContractDetailView> {
    const [parties, noticeDays, guarantors] = await Promise.all([
      this.describeParties([contract]),
      this.noticeDays(),
      this.renters.describeGuarantors(
        contract.guarantorId ? [contract.guarantorId] : [],
      ),
    ])
    const today = todayIso()
    const summary = toSummary(contract, parties, today, noticeDays)
    const latest = contract.rentUpdates[0]
    const nextRentUpdateOn =
      contract.status === ContractStatus.ACTIVE
        ? ContractPolicy.nextRentUpdateOn(
            latest.effectiveFrom,
            contract.rentUpdateFrequency,
          )
        : null

    return {
      ...summary,
      guarantor:
        (contract.guarantorId && guarantors.get(contract.guarantorId)) || null,
      initialRent: contract.initialRent,
      deposit: contract.deposit,
      rentUpdateType: contract.rentUpdateType,
      rentUpdateFrequency: contract.rentUpdateFrequency,
      notes: contract.notes,
      contractPdfUrl: contract.contractPdfUrl,
      surety: contract.surety.hasSurety
        ? {
            insurerName: contract.surety.insurerName,
            insurerAlertEmail: contract.surety.insurerAlertEmail,
            policyNumber: contract.surety.policyNumber,
            policyExpiresAt: contract.surety.policyExpiresAt,
            policyPdfUrl: contract.surety.policyPdfUrl,
            suretyExpired: summary.suretyExpired,
          }
        : null,
      termination: contract.termination,
      renewedFromId: contract.renewedFromId,
      rentUpdates: contract.rentUpdates.map((update) => ({ ...update })),
      nextRentUpdateOn:
        nextRentUpdateOn && nextRentUpdateOn <= contract.endDate
          ? nextRentUpdateOn
          : null,
      timeline: ContractPolicy.timeline(
        contract.startDate,
        contract.endDate,
        today,
      ),
      monthlyStatus: [],
    }
  }

  private async describeParties(contracts: Contract[]): Promise<Parties> {
    const [properties, owners, renters] = await Promise.all([
      this.properties.describe(contracts.map((c) => c.propertyId)),
      this.owners.describe(contracts.map((c) => c.ownerId)),
      this.renters.describe(contracts.map((c) => c.renterId)),
    ])
    return { properties, owners, renters }
  }

  private async noticeDays(): Promise<number> {
    const tenantId = RequestContext.tenantId
    // El guard siempre lo completa; sin tenant, la consulta de contratos ya
    // habría fallado antes (la extensión cierra por defecto).
    if (!tenantId) throw new Error('Consulta de contratos fuera de un tenant')
    return (await this.tenants.getContractSettings(tenantId))
      .contractExpiryNoticeDays
  }
}

function toSummary(
  contract: Contract,
  parties: Parties,
  today: IsoDate,
  noticeDays: number,
): ContractSummaryView {
  return {
    id: contract.id,
    property: parties.properties.get(contract.propertyId) ?? null,
    owner: parties.owners.get(contract.ownerId) ?? null,
    renter: parties.renters.get(contract.renterId) ?? null,
    startDate: contract.startDate,
    endDate: contract.endDate,
    currency: contract.currency,
    currentRent: currentRentOf(contract),
    status: contract.status,
    hasSurety: contract.surety.hasSurety,
    policyExpiresAt: contract.surety.policyExpiresAt,
    suretyExpired: ContractPolicy.isSuretyExpired(
      contract.surety.hasSurety,
      contract.surety.policyExpiresAt,
      today,
    ),
    expiringSoon: ContractPolicy.isExpiringSoon(
      contract.status,
      contract.endDate,
      today,
      noticeDays,
    ),
    expired: ContractPolicy.isExpired(contract.status, contract.endDate, today),
    feePercentage: contract.feePercentage,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
  }
}
