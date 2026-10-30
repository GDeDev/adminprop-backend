import { Injectable } from '@nestjs/common'

import { UserRef, UsersFacade } from '@/modules/auth/public'
import { OwnerRef, OwnersFacade } from '@/modules/owners/public'
import { PropertiesFacade, PropertyRef } from '@/modules/properties/public'
import { RenterRef, RentersFacade } from '@/modules/renters/public'
import { ServicesFacade } from '@/modules/services/public'
import { IsoDate, Period } from '@/shared/dates/calendar-date'
import {
  Currency,
  FeeMode,
  PaymentMethod,
  Settlement,
  SettlementAdjustmentConcept,
  SettlementStatus,
} from '../domain/settlement'

/** Una liquidación en el listado (`SettlementSummaryDto`). Montos como string. */
export interface SettlementSummaryView {
  id: string
  period: Period
  sequence: number
  status: SettlementStatus
  contract: { id: string }
  property: PropertyRef | null
  owner: OwnerRef | null
  renter: RenterRef | null
  currency: Currency
  rentTotal: string
  lateFeeTotal: string
  ownerChargesTotal: string
  serviceChargesTotal: string
  feeTotal: string
  feeDeducted: boolean
  expensesTotal: string
  adjustmentsTotal: string
  netAmount: string
  transferredTotal: string
  statementId: string | null
  hasVoidedPayments: boolean
  confirmedAt: Date | null
  createdAt: Date
}

export interface SettlementPaymentView {
  paymentId: string
  installmentId: string
  installmentPeriod: Period
  paidAt: IsoDate
  rentApplied: string
  lateFeeApplied: string
  ownerChargesApplied: string
  serviceChargesApplied: string
}

export interface SettlementExpenseView {
  expenseId: string
  description: string
  expenseDate: IsoDate
  amount: string
  currency: Currency
}

export interface SettlementAdjustmentView {
  id: string
  concept: SettlementAdjustmentConcept
  description: string
  amount: string
  createdBy: UserRef | null
  createdAt: Date
  voidedAt: Date | null
  voidReason: string | null
}

export interface SettlementTransferView {
  id: string
  transferredAt: IsoDate
  amount: string
  method: PaymentMethod
  receiptUrl: string | null
  notes: string | null
  registeredBy: UserRef | null
  voidedAt: Date | null
}

/** La ficha (`SettlementDetailDto`). */
export interface SettlementDetailView extends SettlementSummaryView {
  feeMode: FeeMode
  feePercentage: string
  feeAmountFixed: string | null
  feeBase: string
  mixedFeeTerms: boolean
  /** A-17: se avisa, no se bloquea. */
  ownerBankAccountMissing: boolean
  payments: SettlementPaymentView[]
  expenses: SettlementExpenseView[]
  /** Gastos pendientes en otra moneda que el contrato (sólo mientras está pendiente). */
  skippedExpenses: SettlementExpenseView[]
  adjustments: SettlementAdjustmentView[]
  transfers: SettlementTransferView[]
  confirmedBy: UserRef | null
  cancelledAt: Date | null
  cancelReason: string | null
  notes: string | null
  updatedAt: Date
}

export interface SettlementParties {
  properties: Map<string, PropertyRef>
  owners: Map<string, OwnerRef>
  renters: Map<string, RenterRef>
}

export function toSettlementSummary(
  settlement: Settlement,
  parties: SettlementParties,
): SettlementSummaryView {
  return {
    id: settlement.id,
    period: settlement.period,
    sequence: settlement.sequence,
    status: settlement.status,
    contract: { id: settlement.contractId },
    property: parties.properties.get(settlement.propertyId) ?? null,
    owner: parties.owners.get(settlement.ownerId) ?? null,
    renter: parties.renters.get(settlement.renterId) ?? null,
    currency: settlement.currency,
    rentTotal: settlement.rentTotal,
    lateFeeTotal: settlement.lateFeeTotal,
    ownerChargesTotal: settlement.ownerChargesTotal,
    serviceChargesTotal: settlement.serviceChargesTotal,
    feeTotal: settlement.feeTotal,
    feeDeducted: settlement.feeDeducted,
    expensesTotal: settlement.expensesTotal,
    adjustmentsTotal: settlement.adjustmentsTotal,
    netAmount: settlement.netAmount,
    transferredTotal: settlement.transferredTotal,
    statementId: settlement.statementId,
    hasVoidedPayments: settlement.hasVoidedPayments,
    confirmedAt: settlement.confirmedAt,
    createdAt: settlement.createdAt,
  }
}

function userIdsOf(settlement: Settlement): string[] {
  return [
    settlement.confirmedById,
    ...settlement.adjustments.map((a) => a.createdById),
    ...settlement.transfers.map((t) => t.registeredById),
  ].filter((id): id is string => id !== null)
}

/**
 * Arma las vistas resolviendo propiedad, propietario, inquilino y usuarios
 * por las facades de sus módulos, una consulta por módulo.
 */
@Injectable()
export class SettlementViews {
  constructor(
    private readonly properties: PropertiesFacade,
    private readonly owners: OwnersFacade,
    private readonly renters: RentersFacade,
    private readonly users: UsersFacade,
    private readonly services: ServicesFacade,
  ) {}

  async parties(
    refs: { propertyId: string; ownerId: string; renterId: string }[],
  ): Promise<SettlementParties> {
    const [properties, owners, renters] = await Promise.all([
      this.properties.describe(refs.map((r) => r.propertyId)),
      this.owners.describe(refs.map((r) => r.ownerId)),
      this.renters.describe(refs.map((r) => r.renterId)),
    ])
    return { properties, owners, renters }
  }

  async summaries(settlements: Settlement[]): Promise<SettlementSummaryView[]> {
    if (settlements.length === 0) return []
    const parties = await this.parties(settlements)
    return settlements.map((s) => toSettlementSummary(s, parties))
  }

  async detail(settlement: Settlement): Promise<SettlementDetailView> {
    const [parties, users, hasBankAccount, skipped] = await Promise.all([
      this.parties([settlement]),
      this.users.describe(userIdsOf(settlement)),
      this.owners.hasBankAccount(settlement.ownerId),
      settlement.status === SettlementStatus.PENDING
        ? this.services.pendingExpensesByContract(settlement.contractId)
        : Promise.resolve({ total: '0.00', items: [] }),
    ])
    const user = (id: string | null) => (id && users.get(id)) || null
    return {
      ...toSettlementSummary(settlement, parties),
      feeMode: settlement.feeMode,
      feePercentage: settlement.feePercentage,
      feeAmountFixed: settlement.feeAmountFixed,
      feeBase: settlement.feeBase,
      mixedFeeTerms: settlement.mixedFeeTerms,
      ownerBankAccountMissing: !hasBankAccount,
      payments: settlement.payments.map((p) => ({
        paymentId: p.paymentId,
        installmentId: p.installmentId,
        installmentPeriod: p.installmentPeriod,
        paidAt: p.paidAt,
        rentApplied: p.rentApplied,
        lateFeeApplied: p.lateFeeApplied,
        ownerChargesApplied: p.ownerChargesApplied,
        serviceChargesApplied: p.serviceChargesApplied,
      })),
      expenses: settlement.expenses.map((e) => ({
        expenseId: e.expenseId,
        description: e.description,
        expenseDate: e.expenseDate,
        amount: e.amount,
        currency: settlement.currency,
      })),
      skippedExpenses: skipped.items
        .filter((e) => e.currency !== settlement.currency)
        .map((e) => ({
          expenseId: e.id,
          description: e.description,
          expenseDate: e.expenseDate,
          amount: e.amount,
          currency: Currency[e.currency],
        })),
      adjustments: settlement.adjustments.map((a) => ({
        id: a.id,
        concept: a.concept,
        description: a.description,
        amount: a.amount,
        createdBy: user(a.createdById),
        createdAt: a.createdAt,
        voidedAt: a.voidedAt,
        voidReason: a.voidReason,
      })),
      transfers: settlement.transfers.map((t) => ({
        id: t.id,
        transferredAt: t.transferredAt,
        amount: t.amount,
        method: t.method,
        receiptUrl: t.receiptUrl,
        notes: t.notes,
        registeredBy: user(t.registeredById),
        voidedAt: t.voidedAt,
      })),
      confirmedBy: user(settlement.confirmedById),
      cancelledAt: settlement.cancelledAt,
      cancelReason: settlement.cancelReason,
      notes: settlement.notes,
      updatedAt: settlement.updatedAt,
    }
  }
}
