import { IsoDate, Period } from '@/shared/dates/calendar-date'
import {
  Currency,
  FeePayer,
  FeePayment,
  FeeReceivable,
  FeeReceivableSource,
  FeeReceivableStatus,
  OwnerStatement,
  OwnerStatementTotals,
  PaymentMethod,
  Settlement,
  SettlementAdjustment,
  SettlementAdjustmentConcept,
  SettlementExpenseLine,
  SettlementPaymentLine,
  SettlementStatus,
  SettlementTotals,
  SettlementTransfer,
  StatementSendMode,
  StatementStatus,
} from './settlement'

export interface PageArgs {
  skip: number
  take: number
}

export interface VoidData {
  voidedById: string
  voidedAt: Date
  voidReason: string
}

// ------------------------------------------------------------ Liquidaciones

export type NewSettlementPaymentLine = Omit<SettlementPaymentLine, 'id'>
export type NewSettlementExpenseLine = Omit<SettlementExpenseLine, 'id'>

export interface NewSettlement extends SettlementTotals {
  contractId: string
  propertyId: string
  ownerId: string
  renterId: string
  currency: Currency
  period: Period
  sequence: number
  payments: NewSettlementPaymentLine[]
  expenses: NewSettlementExpenseLine[]
}

export interface SettlementFilter {
  ids?: string[]
  ownerId?: string
  propertyId?: string
  contractId?: string
  period?: Period
  status?: SettlementStatus
  statuses?: SettlementStatus[]
  /** `null` = sin consolidado. */
  statementId?: string | null
  statementIds?: string[]
}

export interface SettlementChanges extends Partial<SettlementTotals> {
  status?: SettlementStatus
  transferredTotal?: string
  statementId?: string | null
  hasVoidedPayments?: boolean
  confirmedAt?: Date
  confirmedById?: string
  cancelledAt?: Date
  cancelledById?: string
  cancelReason?: string
  notes?: string | null
  acknowledgedAt?: Date
  pdfKey?: string
  pdfUrl?: string
}

export interface NewAdjustment {
  concept: SettlementAdjustmentConcept
  description: string
  amount: string
  originPaymentId: string | null
  createdById: string | null
}

export interface NewTransfer {
  transferredAt: IsoDate
  amount: string
  method: PaymentMethod
  receiptKey: string | null
  receiptUrl: string | null
  notes: string | null
  registeredById: string
}

/**
 * Puerto del repositorio de liquidaciones. Dentro del tenant del contexto;
 * sin bajas. La liquidación se lee siempre completa: pagos, gastos, ajustes
 * y transferencias.
 */
export abstract class SettlementRepository {
  abstract create(data: NewSettlement): Promise<Settlement>

  abstract findById(id: string): Promise<Settlement | null>

  abstract findPendingByContract(contractId: string): Promise<Settlement | null>

  /** La mayor `sequence` de (contrato, mes), o null si no hay ninguna. */
  abstract maxSequence(
    contractId: string,
    period: Period,
  ): Promise<number | null>

  /** Mes descendente, secuencia descendente, alta descendente. */
  abstract list(
    filter: SettlementFilter,
    page: PageArgs,
  ): Promise<[Settlement[], number]>

  abstract listAll(filter: SettlementFilter): Promise<Settlement[]>

  abstract update(id: string, changes: SettlementChanges): Promise<Settlement>

  /** Reemplaza pagos y gastos incluidos (recálculo); vacíos los borra (cancelación). */
  abstract replaceLines(
    id: string,
    payments: NewSettlementPaymentLine[],
    expenses: NewSettlementExpenseLine[],
  ): Promise<void>

  abstract addAdjustment(
    settlementId: string,
    data: NewAdjustment,
  ): Promise<SettlementAdjustment>

  abstract findAdjustment(
    id: string,
  ): Promise<{ settlementId: string; adjustment: SettlementAdjustment } | null>

  abstract voidAdjustment(id: string, data: VoidData): Promise<void>

  abstract addTransfer(
    settlementId: string,
    data: NewTransfer,
  ): Promise<SettlementTransfer>

  abstract findTransfer(
    id: string,
  ): Promise<{ settlementId: string; transfer: SettlementTransfer } | null>

  abstract voidTransfer(id: string, data: VoidData): Promise<void>
}

// ------------------------------------------------------------- Consolidados

export interface NewOwnerStatement {
  ownerId: string
  period: Period
  sendMode: StatementSendMode
}

export interface OwnerStatementFilter {
  ownerId?: string
  period?: Period
  status?: StatementStatus
}

export interface OwnerStatementChanges {
  status?: StatementStatus
  sendMode?: StatementSendMode
  settlementsCount?: number
  closedAt?: Date | null
  closedById?: string | null
  notes?: string | null
  pdfKey?: string
  pdfUrl?: string
}

export abstract class OwnerStatementRepository {
  abstract create(data: NewOwnerStatement): Promise<OwnerStatement>

  abstract findById(id: string): Promise<OwnerStatement | null>

  abstract findByOwnerAndPeriod(
    ownerId: string,
    period: Period,
  ): Promise<OwnerStatement | null>

  /** Mes descendente, alta descendente. */
  abstract list(
    filter: OwnerStatementFilter,
    page: PageArgs,
  ): Promise<[OwnerStatement[], number]>

  abstract listAll(filter: OwnerStatementFilter): Promise<OwnerStatement[]>

  abstract update(
    id: string,
    changes: OwnerStatementChanges,
  ): Promise<OwnerStatement>

  /** Congela (o borra, con lista vacía) los totales por moneda. */
  abstract replaceTotals(
    id: string,
    totals: OwnerStatementTotals[],
  ): Promise<void>
}

// --------------------------------------------------------------- Honorarios

export interface NewFeeReceivable {
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
  feePercentage: string
  feeAmountFixed: string | null
  baseAmount: string
}

export interface FeeReceivableFilter {
  ids?: string[]
  ownerId?: string
  contractId?: string
  currency?: Currency
  status?: FeeReceivableStatus
  statuses?: FeeReceivableStatus[]
}

export interface FeeReceivableChanges {
  paidAmount?: string
  status?: FeeReceivableStatus
  needsReview?: boolean
  voidedAt?: Date | null
}

export abstract class FeeReceivableRepository {
  /** Devuelve null si ya existe uno con el mismo origen (idempotencia). */
  abstract createIfAbsent(data: NewFeeReceivable): Promise<FeeReceivable | null>

  abstract findById(id: string): Promise<FeeReceivable | null>

  abstract findByOriginPayment(paymentId: string): Promise<FeeReceivable | null>

  /** Más nuevos primero. */
  abstract list(
    filter: FeeReceivableFilter,
    page: PageArgs,
  ): Promise<[FeeReceivable[], number]>

  /** Más viejos primero (orden de imputación). */
  abstract listAll(filter: FeeReceivableFilter): Promise<FeeReceivable[]>

  abstract update(
    id: string,
    changes: FeeReceivableChanges,
  ): Promise<FeeReceivable>
}

export interface NewFeePayment {
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
  allocations: { feeReceivableId: string; amount: string }[]
}

export interface FeePaymentFilter {
  ownerId?: string
  contractId?: string
  currency?: Currency
  /** Sólo con saldo sin imputar y vigentes. */
  withUnallocated?: boolean
}

export interface FeePaymentChanges {
  unallocatedAmount?: string
  voidedAt?: Date
  voidedById?: string
  voidReason?: string
}

export abstract class FeePaymentRepository {
  abstract create(data: NewFeePayment): Promise<FeePayment>

  abstract findById(id: string): Promise<FeePayment | null>

  /** Más viejos primero (para aplicar su saldo sin imputar), o más nuevos si `newestFirst`. */
  abstract listAll(
    filter: FeePaymentFilter,
    order?: 'oldest' | 'newest',
  ): Promise<FeePayment[]>

  abstract update(id: string, changes: FeePaymentChanges): Promise<FeePayment>

  abstract addAllocations(
    paymentId: string,
    allocations: { feeReceivableId: string; amount: string }[],
  ): Promise<void>
}
