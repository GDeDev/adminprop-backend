import { IsoDate, Period } from '@/shared/dates/calendar-date'

// Los enums coinciden con los de Prisma. Los que también existen en cobros o
// contratos (`Currency`, `FeeMode`, `PaymentMethod`, `StatementSendMode`) se
// repiten acá porque el dominio no importa otros módulos.

export enum Currency {
  ARS = 'ARS',
  USD = 'USD',
}

export enum FeeMode {
  DEDUCTED = 'DEDUCTED',
  OWNER_PAYS = 'OWNER_PAYS',
  RENTER_PAYS_ON_BEHALF = 'RENTER_PAYS_ON_BEHALF',
}

export enum PaymentMethod {
  TRANSFER = 'TRANSFER',
  CASH = 'CASH',
  CREDIT = 'CREDIT',
  OTHER = 'OTHER',
  DEPOSIT = 'DEPOSIT',
}

/** Medios con los que se transfiere al propietario o se cobran honorarios. */
export const CASH_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.TRANSFER,
  PaymentMethod.CASH,
  PaymentMethod.OTHER,
]

export enum StatementSendMode {
  SUMMARY = 'SUMMARY',
  RECEIPTS = 'RECEIPTS',
  BOTH = 'BOTH',
}

export enum SettlementStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  TRANSFERRED = 'TRANSFERRED',
  CANCELLED = 'CANCELLED',
}

/** Rubros manuales (A-20). Los tres primeros restan; `OTHER_CREDIT` suma. */
export enum SettlementAdjustmentConcept {
  WITHHOLDING = 'WITHHOLDING',
  OWNER_ADVANCE = 'OWNER_ADVANCE',
  OTHER_DEDUCTION = 'OTHER_DEDUCTION',
  OTHER_CREDIT = 'OTHER_CREDIT',
}

export enum StatementStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum FeeReceivableSource {
  OWNER_DIRECT_PAYMENT = 'OWNER_DIRECT_PAYMENT',
  SETTLEMENT_NOT_DEDUCTED = 'SETTLEMENT_NOT_DEDUCTED',
}

export enum FeePayer {
  OWNER = 'OWNER',
  RENTER = 'RENTER',
}

export enum FeeReceivableStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  VOIDED = 'VOIDED',
}

// ------------------------------------------------------------ Entradas puras

/** Términos de honorarios congelados en una cuota (D-71). */
export interface FeeTerms {
  feeMode: FeeMode
  feePercentage: string
  /** Importe fijo; si está, manda sobre el %. */
  feeAmount: string | null
  /** Alquiler de la cuota: la base del fijo (A-15). */
  baseAmount: string
}

/** Qué conceptos cobrados entran en la base del honorario (Micaela #5). */
export interface OwnerFeeRules {
  feeIncludesLateFees: boolean
  feeIncludesCharges: boolean
}

/** Un pago cobrado por la inmobiliaria, como lo recibe la liquidación. */
export interface CollectedPayment {
  paymentId: string
  installmentId: string
  installmentPeriod: Period
  paidAt: IsoDate
  rentApplied: string
  lateFeeApplied: string
  /** Cargos TERMINATION_PENALTY y OTHER (van al propietario). */
  ownerChargesApplied: string
  /** Cargos SERVICE (A-16: no van al neto). */
  serviceChargesApplied: string
  terms: FeeTerms
}

/** Un gasto adelantado pendiente, como lo entrega servicios. */
export interface PendingExpense {
  expenseId: string
  description: string
  expenseDate: IsoDate
  amount: string
  currency: Currency
}

// ----------------------------------------------------------------- Entidades

export interface SettlementPaymentLine {
  id: string
  paymentId: string
  installmentId: string
  installmentPeriod: Period
  paidAt: IsoDate
  rentApplied: string
  lateFeeApplied: string
  ownerChargesApplied: string
  serviceChargesApplied: string
}

export interface SettlementExpenseLine {
  id: string
  expenseId: string
  description: string
  expenseDate: IsoDate
  amount: string
}

export interface SettlementAdjustment {
  id: string
  concept: SettlementAdjustmentConcept
  description: string
  /** Siempre > 0; el signo lo da el concepto. */
  amount: string
  /** El pago anulado que lo generó (A-19); null en los manuales. */
  originPaymentId: string | null
  createdById: string | null
  createdAt: Date
  voidedAt: Date | null
  voidedById: string | null
  voidReason: string | null
}

export interface SettlementTransfer {
  id: string
  transferredAt: IsoDate
  amount: string
  method: PaymentMethod
  receiptKey: string | null
  receiptUrl: string | null
  notes: string | null
  registeredById: string
  voidedAt: Date | null
  voidedById: string | null
  voidReason: string | null
  createdAt: Date
}

/** Totales calculados de una liquidación (4.1 a 4.3). Montos como string. */
export interface SettlementTotals {
  rentTotal: string
  lateFeeTotal: string
  ownerChargesTotal: string
  serviceChargesTotal: string
  feeBase: string
  feePercentage: string
  feeAmountFixed: string | null
  feeTotal: string
  feeMode: FeeMode
  feeDeducted: boolean
  mixedFeeTerms: boolean
  expensesTotal: string
  adjustmentsTotal: string
  netAmount: string
}

/** Liquidación individual (3.1): un contrato, una propiedad, un propietario. */
export interface Settlement extends SettlementTotals {
  id: string
  contractId: string
  propertyId: string
  ownerId: string
  renterId: string
  currency: Currency
  /** Mes en que se liquida (A-21). */
  period: Period
  sequence: number
  status: SettlementStatus
  transferredTotal: string
  statementId: string | null
  hasVoidedPayments: boolean
  confirmedAt: Date | null
  confirmedById: string | null
  cancelledAt: Date | null
  cancelledById: string | null
  cancelReason: string | null
  notes: string | null
  payments: SettlementPaymentLine[]
  expenses: SettlementExpenseLine[]
  /** Todos, anulados incluidos; por alta. */
  adjustments: SettlementAdjustment[]
  /** Todos, anulados incluidos; por fecha. */
  transfers: SettlementTransfer[]
  createdAt: Date
  updatedAt: Date
}

export interface OwnerStatementTotals {
  currency: Currency
  rentTotal: string
  lateFeeTotal: string
  chargesTotal: string
  feeTotal: string
  expensesTotal: string
  adjustmentsTotal: string
  netTotal: string
  transferredTotal: string
}

/** Consolidado mensual por propietario (3.2). */
export interface OwnerStatement {
  id: string
  ownerId: string
  period: Period
  status: StatementStatus
  sendMode: StatementSendMode
  settlementsCount: number
  /** Congelados al cerrar; mientras está abierto se calculan al leer. */
  totals: OwnerStatementTotals[]
  closedAt: Date | null
  closedById: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

/** Honorario devengado a cobrar (3.3). */
export interface FeeReceivable {
  id: string
  ownerId: string
  contractId: string
  installmentId: string | null
  period: Period
  currency: Currency
  source: FeeReceivableSource
  payer: FeePayer
  originPaymentId: string | null
  originSettlementId: string | null
  amount: string
  paidAmount: string
  status: FeeReceivableStatus
  feePercentage: string
  feeAmountFixed: string | null
  baseAmount: string
  needsReview: boolean
  voidedAt: Date | null
  createdAt: Date
}

export interface FeePaymentAllocation {
  id: string
  feeReceivableId: string
  amount: string
}

/** Pago de honorarios a la inmobiliaria, imputado a receivables. */
export interface FeePayment {
  id: string
  ownerId: string
  contractId: string | null
  paidAt: IsoDate
  amount: string
  currency: Currency
  method: PaymentMethod
  paidBy: FeePayer
  unallocatedAmount: string
  receiptKey: string | null
  receiptUrl: string | null
  notes: string | null
  registeredById: string
  voidedAt: Date | null
  voidedById: string | null
  voidReason: string | null
  allocations: FeePaymentAllocation[]
  createdAt: Date
}

export function activeAdjustments(
  settlement: Pick<Settlement, 'adjustments'>,
): SettlementAdjustment[] {
  return settlement.adjustments.filter((a) => a.voidedAt === null)
}

export function activeTransfers(
  settlement: Pick<Settlement, 'transfers'>,
): SettlementTransfer[] {
  return settlement.transfers.filter((t) => t.voidedAt === null)
}

export function isConfirmed(settlement: Pick<Settlement, 'status'>): boolean {
  return (
    settlement.status === SettlementStatus.CONFIRMED ||
    settlement.status === SettlementStatus.TRANSFERRED
  )
}
