// Fixtures de los tests unitarios de billing. No se importan desde código de
// producción (jest.config las deja afuera de la cobertura).
import {
  ChargeConcept,
  CollectionMode,
  CreditStatus,
  Currency,
  FeeMode,
  Installment,
  InstallmentCharge,
  InstallmentStatus,
  LateFeeAdjustment,
  LateFeeAdjustmentKind,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
  RenterCredit,
} from '../domain/billing'
import { sumMoney } from '@/shared/money'

let seq = 0

/** Mediodía UTC del día: cae el mismo día calendario en Argentina. */
export const at = (iso: string) => new Date(`${iso}T15:00:00.000Z`)

/** Cuota de octubre de 2026: 200.000 ARS, 5 % diario, gracia hasta el 10. */
export function makeInstallment(
  overrides: Partial<Installment> = {},
): Installment {
  return {
    id: 'inst-1',
    contractId: 'contract-1',
    renterId: 'renter-1',
    ownerId: 'owner-1',
    propertyId: 'property-1',
    period: '2026-10',
    baseAmount: '200000.00',
    currency: Currency.ARS,
    graceEndDate: '2026-10-10',
    lateFeePercentage: '5.00',
    lateFeeGraceDays: 10,
    collectionMode: CollectionMode.AGENCY,
    feeMode: FeeMode.DEDUCTED,
    feePercentage: '5.00',
    feeAmount: null,
    lateFeeWaived: false,
    status: InstallmentStatus.PENDING,
    paidAt: null,
    notes: null,
    charges: [],
    payments: [],
    adjustments: [],
    frozenFeeDays: [],
    createdAt: at('2026-09-28'),
    updatedAt: at('2026-09-28'),
    ...overrides,
  }
}

export function makePayment(overrides: Partial<Payment> = {}): Payment {
  seq += 1
  const rentApplied = overrides.rentApplied ?? '0.00'
  const lateFeeApplied = overrides.lateFeeApplied ?? '0.00'
  const chargesApplied = overrides.chargesApplied ?? '0.00'
  const total = sumMoney([rentApplied, lateFeeApplied, chargesApplied])
  return {
    id: `pay-${seq}`,
    installmentId: 'inst-1',
    contractId: 'contract-1',
    renterId: 'renter-1',
    paidAt: '2026-10-15',
    paidCurrency: Currency.ARS,
    amount: total,
    exchangeRate: null,
    exchangeRateSource: null,
    exchangeRateDate: null,
    amountInContractCurrency: total,
    kind: PaymentKind.CASH_IN,
    method: PaymentMethod.TRANSFER,
    receivedBy: PaymentReceiver.AGENCY,
    status: PaymentStatus.CONFIRMED,
    lateFeeApplied,
    rentApplied,
    chargesApplied,
    creditGenerated: '0.00',
    creditId: null,
    receiptKey: null,
    receiptUrl: null,
    receiptNumber: null,
    receiptPdfKey: null,
    receiptPdfUrl: null,
    registeredById: 'user-1',
    notes: null,
    confirmedById: null,
    confirmedAt: null,
    voidedById: null,
    voidedAt: null,
    voidReason: null,
    settlementId: null,
    createdAt: at(overrides.paidAt ?? '2026-10-15'),
    ...overrides,
  }
}

export function makeCharge(
  overrides: Partial<InstallmentCharge> = {},
): InstallmentCharge {
  seq += 1
  return {
    id: `charge-${seq}`,
    installmentId: 'inst-1',
    concept: ChargeConcept.SERVICE,
    description: 'Expensas',
    amount: '30000.00',
    createdById: 'user-1',
    createdAt: at('2026-10-02'),
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    ...overrides,
  }
}

export function makeAdjustment(
  overrides: Partial<LateFeeAdjustment> = {},
): LateFeeAdjustment {
  seq += 1
  return {
    id: `adj-${seq}`,
    installmentId: 'inst-1',
    kind: LateFeeAdjustmentKind.REDUCE,
    amount: '10000.00',
    reason: 'Acuerdo con el inquilino',
    createdById: 'admin-1',
    createdAt: at('2026-10-16'),
    ...overrides,
  }
}

export function makeCredit(
  overrides: Partial<RenterCredit> = {},
): RenterCredit {
  seq += 1
  return {
    id: `credit-${seq}`,
    renterId: 'renter-1',
    contractId: 'contract-1',
    currency: Currency.ARS,
    amount: '5000.00',
    remaining: '5000.00',
    originPaymentId: 'pay-origin',
    status: CreditStatus.AVAILABLE,
    heldBy: PaymentReceiver.AGENCY,
    refundedAt: null,
    refundMethod: null,
    refundedById: null,
    refundNotes: null,
    createdAt: at('2026-10-01'),
    ...overrides,
  }
}
