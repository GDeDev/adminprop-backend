import { Prisma } from '@prisma/client'

import {
  Currency,
  FeeMode,
  FeePayer,
  FeePayment,
  FeeReceivable,
  FeeReceivableSource,
  FeeReceivableStatus,
  OwnerStatement,
  PaymentMethod,
  Settlement,
  SettlementAdjustment,
  SettlementAdjustmentConcept,
  SettlementStatus,
  SettlementTransfer,
  StatementSendMode,
  StatementStatus,
} from '@/modules/settlements/domain/settlement'
import { IsoDate } from '@/shared/dates/calendar-date'

/** Las columnas `DATE` se convierten en el borde: el dominio sólo ve `AAAA-MM-DD`. */
export function toDateColumn(value: IsoDate): Date
export function toDateColumn(value: IsoDate | null): Date | null
export function toDateColumn(value: IsoDate | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null
}

export function fromDateColumn(value: Date): IsoDate
export function fromDateColumn(value: Date | null): IsoDate | null
export function fromDateColumn(value: Date | null): IsoDate | null {
  return value ? value.toISOString().slice(0, 10) : null
}

export function money(value: Prisma.Decimal): string
export function money(value: Prisma.Decimal | null): string | null
export function money(value: Prisma.Decimal | null): string | null {
  return value ? value.toFixed(2) : null
}

export const SETTLEMENT_INCLUDE = {
  payments: {
    orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  },
  expenses: {
    orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  },
  adjustments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  transfers: {
    orderBy: [{ transferredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.SettlementInclude

export type SettlementRow = Prisma.SettlementGetPayload<{
  include: typeof SETTLEMENT_INCLUDE
}>
type AdjustmentRow = SettlementRow['adjustments'][number]
type TransferRow = SettlementRow['transfers'][number]

export function settlementToDomain(row: SettlementRow): Settlement {
  return {
    id: row.id,
    contractId: row.contractId,
    propertyId: row.propertyId,
    ownerId: row.ownerId,
    renterId: row.renterId,
    currency: Currency[row.currency],
    period: row.period,
    sequence: row.sequence,
    status: SettlementStatus[row.status],
    rentTotal: money(row.rentTotal),
    lateFeeTotal: money(row.lateFeeTotal),
    ownerChargesTotal: money(row.ownerChargesTotal),
    serviceChargesTotal: money(row.serviceChargesTotal),
    feeBase: money(row.feeBase),
    feePercentage: money(row.feePercentage),
    feeAmountFixed: money(row.feeAmountFixed),
    feeTotal: money(row.feeTotal),
    feeMode: FeeMode[row.feeMode],
    feeDeducted: row.feeDeducted,
    mixedFeeTerms: row.mixedFeeTerms,
    expensesTotal: money(row.expensesTotal),
    adjustmentsTotal: money(row.adjustmentsTotal),
    netAmount: money(row.netAmount),
    transferredTotal: money(row.transferredTotal),
    statementId: row.statementId,
    hasVoidedPayments: row.hasVoidedPayments,
    confirmedAt: row.confirmedAt,
    confirmedById: row.confirmedById,
    cancelledAt: row.cancelledAt,
    cancelledById: row.cancelledById,
    cancelReason: row.cancelReason,
    notes: row.notes,
    pdfKey: row.pdfKey,
    pdfUrl: row.pdfUrl,
    payments: row.payments.map((p) => ({
      id: p.id,
      paymentId: p.paymentId,
      installmentId: p.installmentId,
      installmentPeriod: p.installmentPeriod,
      paidAt: fromDateColumn(p.paidAt),
      rentApplied: money(p.rentApplied),
      lateFeeApplied: money(p.lateFeeApplied),
      ownerChargesApplied: money(p.ownerChargesApplied),
      serviceChargesApplied: money(p.serviceChargesApplied),
    })),
    expenses: row.expenses.map((e) => ({
      id: e.id,
      expenseId: e.expenseId,
      description: e.description,
      expenseDate: fromDateColumn(e.expenseDate),
      amount: money(e.amount),
    })),
    adjustments: row.adjustments.map(adjustmentToDomain),
    transfers: row.transfers.map(transferToDomain),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function adjustmentToDomain(row: AdjustmentRow): SettlementAdjustment {
  return {
    id: row.id,
    concept: SettlementAdjustmentConcept[row.concept],
    description: row.description,
    amount: money(row.amount),
    originPaymentId: row.originPaymentId,
    createdById: row.createdById,
    createdAt: row.createdAt,
    voidedAt: row.voidedAt,
    voidedById: row.voidedById,
    voidReason: row.voidReason,
  }
}

export function transferToDomain(row: TransferRow): SettlementTransfer {
  return {
    id: row.id,
    transferredAt: fromDateColumn(row.transferredAt),
    amount: money(row.amount),
    method: PaymentMethod[row.method],
    receiptKey: row.receiptKey,
    receiptUrl: row.receiptUrl,
    notes: row.notes,
    registeredById: row.registeredById,
    voidedAt: row.voidedAt,
    voidedById: row.voidedById,
    voidReason: row.voidReason,
    createdAt: row.createdAt,
  }
}

export const STATEMENT_INCLUDE = {
  totals: { orderBy: { currency: 'asc' } },
} satisfies Prisma.OwnerStatementInclude

export type StatementRow = Prisma.OwnerStatementGetPayload<{
  include: typeof STATEMENT_INCLUDE
}>

export function statementToDomain(row: StatementRow): OwnerStatement {
  return {
    id: row.id,
    ownerId: row.ownerId,
    period: row.period,
    status: StatementStatus[row.status],
    sendMode: StatementSendMode[row.sendMode],
    settlementsCount: row.settlementsCount,
    totals: row.totals.map((t) => ({
      currency: Currency[t.currency],
      rentTotal: money(t.rentTotal),
      lateFeeTotal: money(t.lateFeeTotal),
      chargesTotal: money(t.chargesTotal),
      feeTotal: money(t.feeTotal),
      expensesTotal: money(t.expensesTotal),
      adjustmentsTotal: money(t.adjustmentsTotal),
      netTotal: money(t.netTotal),
      transferredTotal: money(t.transferredTotal),
    })),
    closedAt: row.closedAt,
    closedById: row.closedById,
    notes: row.notes,
    pdfKey: row.pdfKey,
    pdfUrl: row.pdfUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

type ReceivableRow = Prisma.FeeReceivableGetPayload<Record<string, never>>

export function receivableToDomain(row: ReceivableRow): FeeReceivable {
  return {
    id: row.id,
    ownerId: row.ownerId,
    contractId: row.contractId,
    installmentId: row.installmentId,
    period: row.period,
    currency: Currency[row.currency],
    source: FeeReceivableSource[row.source],
    payer: FeePayer[row.payer],
    originPaymentId: row.originPaymentId,
    originSettlementId: row.originSettlementId,
    amount: money(row.amount),
    paidAmount: money(row.paidAmount),
    status: FeeReceivableStatus[row.status],
    feePercentage: money(row.feePercentage),
    feeAmountFixed: money(row.feeAmountFixed),
    baseAmount: money(row.baseAmount),
    needsReview: row.needsReview,
    voidedAt: row.voidedAt,
    createdAt: row.createdAt,
  }
}

export const FEE_PAYMENT_INCLUDE = {
  allocations: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.FeePaymentInclude

export type FeePaymentRow = Prisma.FeePaymentGetPayload<{
  include: typeof FEE_PAYMENT_INCLUDE
}>

export function feePaymentToDomain(row: FeePaymentRow): FeePayment {
  return {
    id: row.id,
    ownerId: row.ownerId,
    contractId: row.contractId,
    paidAt: fromDateColumn(row.paidAt),
    amount: money(row.amount),
    currency: Currency[row.currency],
    method: PaymentMethod[row.method],
    paidBy: FeePayer[row.paidBy],
    unallocatedAmount: money(row.unallocatedAmount),
    receiptKey: row.receiptKey,
    receiptUrl: row.receiptUrl,
    notes: row.notes,
    registeredById: row.registeredById,
    voidedAt: row.voidedAt,
    voidedById: row.voidedById,
    voidReason: row.voidReason,
    allocations: row.allocations.map((a) => ({
      id: a.id,
      feeReceivableId: a.feeReceivableId,
      amount: money(a.amount),
    })),
    createdAt: row.createdAt,
  }
}
