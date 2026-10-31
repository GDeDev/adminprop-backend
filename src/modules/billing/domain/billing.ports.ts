import { IsoDate, Period } from '@/shared/dates/calendar-date'
import {
  ChargeConcept,
  CollectionMode,
  CreditStatus,
  Currency,
  DepositDeductionConcept,
  DepositReturn,
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
} from './billing'

export interface PageArgs {
  skip: number
  take: number
}

// ------------------------------------------------------------------ Cuotas

export interface NewInstallment {
  contractId: string
  renterId: string
  ownerId: string
  propertyId: string
  period: Period
  baseAmount: string
  currency: Currency
  graceEndDate: IsoDate
  lateFeePercentage: string
  lateFeeGraceDays: number
  collectionMode: CollectionMode
  feeMode: FeeMode
  feePercentage: string
  feeAmount: string | null
}

export interface InstallmentFilter {
  ids?: string[]
  period?: Period
  /** `OVERDUE` se traduce a "con saldo y gracia vencida" en la consulta. */
  status?: InstallmentStatus
  contractId?: string
  renterId?: string
  renterIds?: string[]
  propertyId?: string
  ownerId?: string
  collectionMode?: CollectionMode
  /** Sólo las no saldadas (PENDING o PARTIAL). */
  unpaid?: boolean
  /** Impagas (no PAID) cuya gracia terminó antes de esta fecha: vencidas. */
  unpaidGraceEndBefore?: IsoDate
  /** Para `PENDING`/`PARTIAL`: gracia que termina en esta fecha o después. */
  graceEndFrom?: IsoDate
}

export interface InstallmentChanges {
  /** Sólo lo corrige el aumento de un contrato sobre cuotas sin movimientos. */
  baseAmount?: string
  status?: StoredInstallmentStatus
  paidAt?: IsoDate | null
  lateFeeWaived?: boolean
  notes?: string | null
}

export interface NewCharge {
  concept: ChargeConcept
  description: string
  amount: string
}

export interface NewLateFeeAdjustment {
  kind: LateFeeAdjustmentKind
  amount: string
  reason: string
}

/**
 * Puerto del repositorio de cuotas. Dentro del tenant del contexto; sin
 * bajas. La cuota se lee siempre completa: cargos, pagos, ajustes y detalle
 * diario congelado.
 */
export abstract class InstallmentRepository {
  /**
   * Crea la cuota, o devuelve `null` si ya existe una para ese contrato y
   * período (índice único: la generación es idempotente por construcción).
   */
  abstract createIfAbsent(data: NewInstallment): Promise<Installment | null>

  abstract findById(id: string): Promise<Installment | null>

  /** Período descendente, y dentro del mes por alta. */
  abstract list(
    filter: InstallmentFilter,
    page: PageArgs,
  ): Promise<[Installment[], number]>

  /** Sin paginar, para resúmenes, cuenta corriente y mora. */
  abstract listAll(filter: InstallmentFilter): Promise<Installment[]>

  abstract update(id: string, changes: InstallmentChanges): Promise<Installment>

  /** Reemplaza el detalle diario congelado (vacío lo borra). */
  abstract replaceFeeDays(
    installmentId: string,
    days: LateFeeDay[],
  ): Promise<void>

  abstract addCharge(
    installmentId: string,
    data: NewCharge,
  ): Promise<InstallmentCharge>

  abstract findCharge(id: string): Promise<InstallmentCharge | null>

  abstract voidCharge(
    id: string,
    data: { voidedById: string; voidedAt: Date; voidReason: string },
  ): Promise<InstallmentCharge>

  abstract addAdjustment(
    installmentId: string,
    data: NewLateFeeAdjustment,
  ): Promise<LateFeeAdjustment>
}

// ------------------------------------------------------------------- Pagos

export interface NewPayment {
  installmentId: string
  contractId: string
  renterId: string
  paidAt: IsoDate
  paidCurrency: Currency
  amount: string
  exchangeRate: string | null
  exchangeRateSource: ExchangeRateSource | null
  exchangeRateDate: IsoDate | null
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
  registeredById: string
  notes: string | null
}

export interface PaymentFilter {
  contractId?: string
  renterId?: string
  installmentId?: string
  status?: PaymentStatus
  receivedBy?: PaymentReceiver
  /** Rango de `paidAt`, inclusive. */
  from?: IsoDate
  to?: IsoDate
}

/** Puerto del repositorio de pagos. Nunca se borran: se anulan. */
export abstract class PaymentRepository {
  abstract create(data: NewPayment): Promise<Payment>

  abstract findById(id: string): Promise<Payment | null>

  /** Más nuevos primero (fecha de pago, después alta). */
  abstract list(
    filter: PaymentFilter,
    page: PageArgs,
  ): Promise<[Payment[], number]>

  abstract listAll(filter: PaymentFilter): Promise<Payment[]>

  abstract confirm(
    id: string,
    data: { confirmedById: string; confirmedAt: Date },
  ): Promise<Payment>

  abstract void(
    id: string,
    data: { voidedById: string; voidedAt: Date; voidReason: string },
  ): Promise<Payment>

  /**
   * Los pagos de un contrato que una liquidación puede tomar (Fase 12):
   * confirmados, recibidos por la inmobiliaria (plata o saldo a favor) y sin
   * liquidación. Más viejos primero.
   */
  abstract listSettleable(contractId: string): Promise<Payment[]>

  /** Marca los pagos como liquidados; sólo los que no lo estaban. Devuelve cuántos. */
  abstract markSettled(ids: string[], settlementId: string): Promise<number>

  /** Libera los pagos de una liquidación (cancelación o recálculo). */
  abstract unmarkSettled(settlementId: string): Promise<number>
}

// --------------------------------------------------------------- Depósito

export interface NewDepositReturn {
  contractId: string
  returnedAt: IsoDate
  depositAmount: string
  depositCurrency: Currency
  returnedAmount: string
  method: PaymentMethod
  notes: string | null
  registeredById: string
  deductions: {
    concept: DepositDeductionConcept
    description: string
    amount: string
    installmentId: string | null
    paymentId: string | null
  }[]
}

/** Puerto de la devolución del depósito. Una por contrato; no se borra. */
export abstract class DepositReturnRepository {
  abstract create(data: NewDepositReturn): Promise<DepositReturn>

  abstract findByContract(contractId: string): Promise<DepositReturn | null>
}

// ---------------------------------------------------------------- Créditos

export interface NewRenterCredit {
  renterId: string
  contractId: string
  currency: Currency
  amount: string
  originPaymentId: string
}

export interface RenterCreditChanges {
  remaining?: string
  status?: CreditStatus
  refundedAt?: IsoDate
  refundMethod?: PaymentMethod
  refundedById?: string
  refundNotes?: string | null
}

/** Puerto del repositorio de saldos a favor. */
export abstract class RenterCreditRepository {
  abstract create(data: NewRenterCredit): Promise<RenterCredit>

  abstract findById(id: string): Promise<RenterCredit | null>

  /** El crédito que generó un pago, si lo hubo. */
  abstract findByOriginPayment(paymentId: string): Promise<RenterCredit | null>

  /** Disponibles del inquilino en esa moneda, los más viejos primero. */
  abstract listAvailable(
    renterId: string,
    currency: Currency,
  ): Promise<RenterCredit[]>

  /** Todos los del inquilino, los más nuevos primero. */
  abstract listByRenter(renterId: string): Promise<RenterCredit[]>

  /** Todos los de un contrato, los más viejos primero (cuenta corriente). */
  abstract listByContract(contractId: string): Promise<RenterCredit[]>

  abstract update(
    id: string,
    changes: RenterCreditChanges,
  ): Promise<RenterCredit>
}
