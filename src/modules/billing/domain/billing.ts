import { IsoDate, Period } from '@/shared/dates/calendar-date'

// Los enums coinciden con los de Prisma (mismos valores). Los que también
// existen en contratos (`Currency`, `CollectionMode`, `FeeMode`) se repiten
// acá porque el dominio no importa otros módulos; la cuota los copia como
// snapshot al generarse (D-71).

export enum Currency {
  ARS = 'ARS',
  USD = 'USD',
}

export enum CollectionMode {
  AGENCY = 'AGENCY',
  OWNER_DIRECT = 'OWNER_DIRECT',
}

export enum FeeMode {
  DEDUCTED = 'DEDUCTED',
  OWNER_PAYS = 'OWNER_PAYS',
  RENTER_PAYS_ON_BEHALF = 'RENTER_PAYS_ON_BEHALF',
}

/**
 * Estado de una cuota tal como se muestra. En la base sólo se guarda
 * `PENDING | PARTIAL | PAID`; `OVERDUE` se calcula al leer (D-71): con saldo
 * y con el último día sin punitorio ya pasado.
 */
export enum InstallmentStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  OVERDUE = 'OVERDUE',
  PAID = 'PAID',
}

/** Lo que se guarda: nunca `OVERDUE`. */
export type StoredInstallmentStatus =
  InstallmentStatus.PENDING | InstallmentStatus.PARTIAL | InstallmentStatus.PAID

export enum ChargeConcept {
  SERVICE = 'SERVICE',
  TERMINATION_PENALTY = 'TERMINATION_PENALTY',
  OTHER = 'OTHER',
}

export enum ExchangeRateSource {
  OFFICIAL = 'OFFICIAL',
  MEP = 'MEP',
  OTHER = 'OTHER',
}

export enum PaymentKind {
  CASH_IN = 'CASH_IN',
  CREDIT_APPLICATION = 'CREDIT_APPLICATION',
}

export enum PaymentMethod {
  TRANSFER = 'TRANSFER',
  CASH = 'CASH',
  CREDIT = 'CREDIT',
  OTHER = 'OTHER',
  /** Deuda cubierta con el depósito en garantía al devolverlo (Fase 12). */
  DEPOSIT = 'DEPOSIT',
}

/** Por qué se descuenta algo del depósito al devolverlo (Micaela #1). */
export enum DepositDeductionConcept {
  DEBT = 'DEBT',
  DAMAGE = 'DAMAGE',
  OTHER = 'OTHER',
}

export enum PaymentReceiver {
  AGENCY = 'AGENCY',
  OWNER = 'OWNER',
}

export enum PaymentStatus {
  PENDING_CONFIRMATION = 'PENDING_CONFIRMATION',
  CONFIRMED = 'CONFIRMED',
  VOIDED = 'VOIDED',
}

export enum LateFeeAdjustmentKind {
  REDUCE = 'REDUCE',
  WAIVE = 'WAIVE',
}

export enum CreditStatus {
  AVAILABLE = 'AVAILABLE',
  APPLIED = 'APPLIED',
  REFUNDED = 'REFUNDED',
  VOIDED = 'VOIDED',
}

/** Un concepto además del alquiler. Anulado no cuenta. Montos como string. */
export interface InstallmentCharge {
  id: string
  installmentId: string
  concept: ChargeConcept
  description: string
  amount: string
  createdById: string | null
  createdAt: Date
  voidedAt: Date | null
  voidedById: string | null
  voidReason: string | null
}

/** Un pago (o la aplicación de un saldo a favor) sobre una cuota. */
export interface Payment {
  id: string
  installmentId: string
  contractId: string
  renterId: string
  /** Fecha real del pago. */
  paidAt: IsoDate
  paidCurrency: Currency
  /** Lo entregado, en `paidCurrency`. */
  amount: string
  exchangeRate: string | null
  exchangeRateSource: ExchangeRateSource | null
  exchangeRateDate: IsoDate | null
  /** El equivalente en la moneda de la cuota. */
  amountInContractCurrency: string
  kind: PaymentKind
  method: PaymentMethod
  receivedBy: PaymentReceiver
  status: PaymentStatus
  lateFeeApplied: string
  rentApplied: string
  chargesApplied: string
  creditGenerated: string
  creditId: string | null
  receiptKey: string | null
  receiptUrl: string | null
  /** Recibo de la inmobiliaria (Fase 15): número correlativo y PDF vigente. */
  receiptNumber: string | null
  receiptPdfKey: string | null
  receiptPdfUrl: string | null
  registeredById: string
  notes: string | null
  confirmedById: string | null
  confirmedAt: Date | null
  voidedById: string | null
  voidedAt: Date | null
  voidReason: string | null
  /** Liquidación que lo incluyó (Fase 12); null = sin liquidar. */
  settlementId: string | null
  createdAt: Date
}

export interface LateFeeAdjustment {
  id: string
  installmentId: string
  kind: LateFeeAdjustmentKind
  amount: string
  reason: string
  createdById: string | null
  createdAt: Date
}

/** Un día de punitorio: cómo se armó el monto (A-4). */
export interface LateFeeDay {
  day: IsoDate
  /** 1 = primer día con punitorio. */
  dayNumber: number
  /** Alquiler impago ese día. */
  outstandingBase: string
  dailyPercentage: string
  amount: string
}

/**
 * Cuota devengada de un contrato y mes (PRD 5.6 "Pago"), con sus cargos,
 * pagos, ajustes y, si ya se saldó el alquiler, el detalle diario congelado.
 * Montos como string decimal.
 */
export interface Installment {
  id: string
  contractId: string
  renterId: string
  ownerId: string
  propertyId: string
  /** `AAAA-MM`. */
  period: Period
  /** Alquiler vigente al generar (D-72). */
  baseAmount: string
  currency: Currency
  /** Último día sin punitorio. */
  graceEndDate: IsoDate
  /** Snapshot de los términos al generar (D-71). */
  lateFeePercentage: string
  lateFeeGraceDays: number
  collectionMode: CollectionMode
  feeMode: FeeMode
  feePercentage: string
  feeAmount: string | null
  lateFeeWaived: boolean
  status: StoredInstallmentStatus
  /** Día en que el alquiler quedó saldado. */
  paidAt: IsoDate | null
  notes: string | null
  charges: InstallmentCharge[]
  /** Todos, incluidos los anulados; los más nuevos primero. */
  payments: Payment[]
  adjustments: LateFeeAdjustment[]
  /** Vacío mientras el alquiler no se saldó. */
  frozenFeeDays: LateFeeDay[]
  createdAt: Date
  updatedAt: Date
}

/** Saldo a favor de un inquilino (A-6). */
export interface RenterCredit {
  id: string
  renterId: string
  contractId: string
  currency: Currency
  amount: string
  remaining: string
  originPaymentId: string
  status: CreditStatus
  refundedAt: IsoDate | null
  refundMethod: PaymentMethod | null
  refundedById: string | null
  refundNotes: string | null
  createdAt: Date
}

/** Una deducción del depósito, justificada. */
export interface DepositReturnDeduction {
  id: string
  concept: DepositDeductionConcept
  description: string
  amount: string
  /** Cuota a la que se imputó una deuda. */
  installmentId: string | null
  /** El pago `DEPOSIT` que se creó sobre esa cuota. */
  paymentId: string | null
}

/**
 * Devolución del depósito en garantía (Fase 12, 2.2; A-13 cerrado): una por
 * contrato, con `returnedAmount + Σ deducciones = depositAmount`.
 */
export interface DepositReturn {
  id: string
  contractId: string
  returnedAt: IsoDate
  depositAmount: string
  depositCurrency: Currency
  returnedAmount: string
  method: PaymentMethod
  notes: string | null
  registeredById: string
  deductions: DepositReturnDeduction[]
  createdAt: Date
}

export function isVoided(payment: Pick<Payment, 'status'>): boolean {
  return payment.status === PaymentStatus.VOIDED
}

/** Los pagos que cuentan: todo lo no anulado, informado incluido (A-11). */
export function activePayments(installment: Pick<Installment, 'payments'>) {
  return installment.payments.filter((p) => !isVoided(p))
}

export function activeCharges(installment: Pick<Installment, 'charges'>) {
  return installment.charges.filter((c) => c.voidedAt === null)
}
