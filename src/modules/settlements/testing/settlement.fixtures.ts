// Fixtures de los tests unitarios de liquidaciones. No se importan desde
// código de producción (jest.config las deja afuera de la cobertura).
import {
  Currency,
  FeeMode,
  FeePayer,
  FeePayment,
  FeeReceivable,
  FeeReceivableSource,
  FeeReceivableStatus,
  PaymentMethod,
  Settlement,
  SettlementAdjustment,
  SettlementAdjustmentConcept,
  SettlementPaymentLine,
  SettlementStatus,
} from '../domain/settlement'

let seq = 0

export function makeSettlement(
  overrides: Partial<Settlement> = {},
): Settlement {
  seq += 1
  return {
    id: `settlement-${seq}`,
    contractId: 'contract-1',
    propertyId: 'property-1',
    ownerId: 'owner-1',
    renterId: 'renter-1',
    currency: Currency.ARS,
    period: '2026-10',
    sequence: 1,
    status: SettlementStatus.PENDING,
    rentTotal: '0.00',
    lateFeeTotal: '0.00',
    ownerChargesTotal: '0.00',
    serviceChargesTotal: '0.00',
    feeBase: '0.00',
    feePercentage: '5.00',
    feeAmountFixed: null,
    feeTotal: '0.00',
    feeMode: FeeMode.DEDUCTED,
    feeDeducted: true,
    mixedFeeTerms: false,
    expensesTotal: '0.00',
    adjustmentsTotal: '0.00',
    netAmount: '0.00',
    transferredTotal: '0.00',
    statementId: null,
    hasVoidedPayments: false,
    confirmedAt: null,
    confirmedById: null,
    cancelledAt: null,
    cancelledById: null,
    cancelReason: null,
    notes: null,
    acknowledgedAt: null,
    pdfKey: null,
    pdfUrl: null,
    payments: [],
    expenses: [],
    adjustments: [],
    transfers: [],
    createdAt: new Date('2026-10-01T15:00:00.000Z'),
    updatedAt: new Date('2026-10-01T15:00:00.000Z'),
    ...overrides,
  }
}

export function makePaymentLine(
  overrides: Partial<SettlementPaymentLine> = {},
): SettlementPaymentLine {
  seq += 1
  return {
    id: `line-${seq}`,
    paymentId: `pay-${seq}`,
    installmentId: 'inst-1',
    installmentPeriod: '2026-10',
    paidAt: '2026-10-05',
    rentApplied: '100000.00',
    lateFeeApplied: '0.00',
    ownerChargesApplied: '0.00',
    serviceChargesApplied: '0.00',
    ...overrides,
  }
}

export function makeAdjustment(
  overrides: Partial<SettlementAdjustment> = {},
): SettlementAdjustment {
  seq += 1
  return {
    id: `adj-${seq}`,
    concept: SettlementAdjustmentConcept.OTHER_DEDUCTION,
    description: 'Ajuste',
    amount: '1000.00',
    originPaymentId: null,
    createdById: null,
    createdAt: new Date('2026-10-02T15:00:00.000Z'),
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    ...overrides,
  }
}

export function makeReceivable(
  overrides: Partial<FeeReceivable> = {},
): FeeReceivable {
  seq += 1
  return {
    id: `recv-${seq}`,
    ownerId: 'owner-1',
    contractId: 'contract-1',
    installmentId: 'inst-1',
    period: '2026-10',
    currency: Currency.ARS,
    source: FeeReceivableSource.OWNER_DIRECT_PAYMENT,
    payer: FeePayer.OWNER,
    originPaymentId: `pay-${seq}`,
    originSettlementId: null,
    amount: '10000.00',
    paidAmount: '0.00',
    status: FeeReceivableStatus.PENDING,
    feePercentage: '5.00',
    feeAmountFixed: null,
    baseAmount: '200000.00',
    needsReview: false,
    voidedAt: null,
    createdAt: new Date('2026-10-01T15:00:00.000Z'),
    ...overrides,
  }
}

export function makeFeePayment(
  overrides: Partial<FeePayment> = {},
): FeePayment {
  seq += 1
  return {
    id: `fpay-${seq}`,
    ownerId: 'owner-1',
    contractId: null,
    paidAt: '2026-10-05',
    amount: '5000.00',
    currency: Currency.ARS,
    method: PaymentMethod.TRANSFER,
    paidBy: FeePayer.OWNER,
    unallocatedAmount: '5000.00',
    receiptKey: null,
    receiptUrl: null,
    notes: null,
    registeredById: 'user-1',
    voidedAt: null,
    voidedById: null,
    voidReason: null,
    allocations: [],
    createdAt: new Date('2026-10-05T15:00:00.000Z'),
    ...overrides,
  }
}
