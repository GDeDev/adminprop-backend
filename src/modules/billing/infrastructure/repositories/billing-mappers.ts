import { Prisma } from '@prisma/client'

import {
  ChargeConcept,
  CollectionMode,
  CreditStatus,
  Currency,
  ExchangeRateSource,
  FeeMode,
  Installment,
  InstallmentCharge,
  InstallmentStatus,
  LateFeeAdjustment,
  LateFeeAdjustmentKind,
  LateFeeDay,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
  RenterCredit,
  StoredInstallmentStatus,
} from '@/modules/billing/domain/billing'
import { IsoDate } from '@/shared/dates/calendar-date'

/**
 * Las columnas `DATE` se convierten en el borde (como en contratos, D-49):
 * el dominio sólo ve `AAAA-MM-DD`.
 */
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

/** La cuota viaja siempre con sus cargos, pagos, ajustes y detalle diario. */
export const INSTALLMENT_INCLUDE = {
  charges: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  payments: {
    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
  },
  adjustments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  feeDays: { orderBy: { dayNumber: 'asc' } },
} satisfies Prisma.InstallmentInclude

export type InstallmentRow = Prisma.InstallmentGetPayload<{
  include: typeof INSTALLMENT_INCLUDE
}>
type ChargeRow = InstallmentRow['charges'][number]
type PaymentRow = InstallmentRow['payments'][number]
type AdjustmentRow = InstallmentRow['adjustments'][number]
type FeeDayRow = InstallmentRow['feeDays'][number]
type CreditRow = Prisma.RenterCreditGetPayload<Record<string, never>>

export function installmentToDomain(row: InstallmentRow): Installment {
  return {
    id: row.id,
    contractId: row.contractId,
    renterId: row.renterId,
    ownerId: row.ownerId,
    propertyId: row.propertyId,
    period: row.period,
    baseAmount: money(row.baseAmount),
    currency: Currency[row.currency],
    graceEndDate: fromDateColumn(row.graceEndDate),
    lateFeePercentage: money(row.lateFeePercentage),
    lateFeeGraceDays: row.lateFeeGraceDays,
    collectionMode: CollectionMode[row.collectionMode],
    feeMode: FeeMode[row.feeMode],
    feePercentage: money(row.feePercentage),
    feeAmount: money(row.feeAmount),
    lateFeeWaived: row.lateFeeWaived,
    status: InstallmentStatus[row.status] as StoredInstallmentStatus,
    paidAt: fromDateColumn(row.paidAt),
    notes: row.notes,
    charges: row.charges.map(chargeToDomain),
    payments: row.payments.map(paymentToDomain),
    adjustments: row.adjustments.map(adjustmentToDomain),
    frozenFeeDays: row.feeDays.map(feeDayToDomain),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function chargeToDomain(row: ChargeRow): InstallmentCharge {
  return {
    id: row.id,
    installmentId: row.installmentId,
    concept: ChargeConcept[row.concept],
    description: row.description,
    amount: money(row.amount),
    createdById: row.createdById,
    createdAt: row.createdAt,
    voidedAt: row.voidedAt,
    voidedById: row.voidedById,
    voidReason: row.voidReason,
  }
}

export function paymentToDomain(row: PaymentRow): Payment {
  return {
    id: row.id,
    installmentId: row.installmentId,
    contractId: row.contractId,
    renterId: row.renterId,
    paidAt: fromDateColumn(row.paidAt),
    paidCurrency: Currency[row.paidCurrency],
    amount: money(row.amount),
    exchangeRate: row.exchangeRate ? row.exchangeRate.toFixed(4) : null,
    exchangeRateSource: row.exchangeRateSource
      ? ExchangeRateSource[row.exchangeRateSource]
      : null,
    exchangeRateDate: fromDateColumn(row.exchangeRateDate),
    amountInContractCurrency: money(row.amountInContractCurrency),
    kind: PaymentKind[row.kind],
    method: PaymentMethod[row.method],
    receivedBy: PaymentReceiver[row.receivedBy],
    status: PaymentStatus[row.status],
    lateFeeApplied: money(row.lateFeeApplied),
    rentApplied: money(row.rentApplied),
    chargesApplied: money(row.chargesApplied),
    creditGenerated: money(row.creditGenerated),
    creditId: row.creditId,
    receiptKey: row.receiptKey,
    receiptUrl: row.receiptUrl,
    registeredById: row.registeredById,
    notes: row.notes,
    confirmedById: row.confirmedById,
    confirmedAt: row.confirmedAt,
    voidedById: row.voidedById,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    createdAt: row.createdAt,
  }
}

export function adjustmentToDomain(row: AdjustmentRow): LateFeeAdjustment {
  return {
    id: row.id,
    installmentId: row.installmentId,
    kind: LateFeeAdjustmentKind[row.kind],
    amount: money(row.amount),
    reason: row.reason,
    createdById: row.createdById,
    createdAt: row.createdAt,
  }
}

export function feeDayToDomain(row: FeeDayRow): LateFeeDay {
  return {
    day: fromDateColumn(row.day),
    dayNumber: row.dayNumber,
    outstandingBase: money(row.outstandingBase),
    dailyPercentage: money(row.dailyPercentage),
    amount: money(row.amount),
  }
}

export function creditToDomain(row: CreditRow): RenterCredit {
  return {
    id: row.id,
    renterId: row.renterId,
    contractId: row.contractId,
    currency: Currency[row.currency],
    amount: money(row.amount),
    remaining: money(row.remaining),
    originPaymentId: row.originPaymentId,
    status: CreditStatus[row.status],
    refundedAt: fromDateColumn(row.refundedAt),
    refundMethod: row.refundMethod ? PaymentMethod[row.refundMethod] : null,
    refundedById: row.refundedById,
    refundNotes: row.refundNotes,
    createdAt: row.createdAt,
  }
}
