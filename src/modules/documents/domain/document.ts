import { IsoDate, Period } from '@/shared/dates/calendar-date'

// Los enums coinciden con los de Prisma.

export enum DocumentKind {
  SETTLEMENT = 'SETTLEMENT',
  OWNER_STATEMENT = 'OWNER_STATEMENT',
  PAYMENT_RECEIPT = 'PAYMENT_RECEIPT',
  TERMINATION_NOTICE = 'TERMINATION_NOTICE',
}

export enum DocumentStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export type DocumentCurrency = 'ARS' | 'USD'

/**
 * Un PDF generado, en una versión. La vigente de una entidad es la última
 * `READY`; regenerar crea una versión nueva y no pisa el archivo anterior.
 */
export interface GeneratedDocument {
  id: string
  kind: DocumentKind
  /** La liquidación, el consolidado, el pago o el contrato, según `kind`. */
  entityId: string
  version: number
  status: DocumentStatus
  storageKey: string | null
  url: string | null
  sizeBytes: number | null
  error: string | null
  generatedAt: Date | null
  requestedById: string | null
  /** Los datos con los que se armó (JSON): ver `DocumentData`. */
  dataSnapshot: DocumentData | null
  createdAt: Date
}

// ---------------------------------------------------------------- Los datos
//
// Lo que cada plantilla necesita, con todo ya resuelto (nombres, textos de
// enum aparte) y sólo strings, números y booleanos: es JSON puro, se guarda
// como `data_snapshot` y se compara para saber si un evento repetido trae algo
// distinto. Los montos son strings decimales; las fechas, `AAAA-MM-DD`.

export interface PartyData {
  name: string
  nationalId: string | null
}

export interface SettlementPaymentLineData {
  installmentPeriod: Period
  paidAt: IsoDate
  rent: string
  lateFee: string
  /** Cargos al propietario más cargos de servicios. */
  charges: string
}

export interface SettlementFeeData {
  /** `DEDUCTED | OWNER_PAYS | RENTER_PAYS_ON_BEHALF`. */
  mode: string
  percentage: string
  fixedAmount: string | null
  base: string
  total: string
  deducted: boolean
  mixedTerms: boolean
}

export interface SettlementAdjustmentData {
  /** `WITHHOLDING | OWNER_ADVANCE | OTHER_DEDUCTION | OTHER_CREDIT`. */
  concept: string
  description: string
  /** Con signo: resta salvo `OTHER_CREDIT`. */
  amount: string
}

export interface SettlementDocumentData {
  period: Period
  sequence: number
  currency: DocumentCurrency
  owner: PartyData | null
  property: string | null
  renter: string | null
  payments: SettlementPaymentLineData[]
  rentTotal: string
  lateFeeTotal: string
  ownerChargesTotal: string
  serviceChargesTotal: string
  fee: SettlementFeeData
  expenses: { date: IsoDate; description: string; amount: string }[]
  adjustments: SettlementAdjustmentData[]
  netAmount: string
  transfers: { date: IsoDate; amount: string; method: string }[]
  transferredTotal: string
  confirmedAt: IsoDate | null
}

export interface StatementRowData {
  property: string | null
  /** Mes liquidado y cuotas que cubre. */
  settlementPeriod: Period
  installmentPeriods: Period[]
  rent: string
  lateFee: string
  charges: string
  fee: string
  expenses: string
  adjustments: string
  net: string
  transferred: string
  currency: DocumentCurrency
}

export interface StatementTotalsData {
  currency: DocumentCurrency
  rent: string
  lateFee: string
  charges: string
  fee: string
  expenses: string
  adjustments: string
  net: string
  transferred: string
}

export interface OwnerStatementDocumentData {
  period: Period
  owner: PartyData | null
  /** `SUMMARY | RECEIPTS | BOTH`. */
  sendMode: string
  rows: StatementRowData[]
  totals: StatementTotalsData[]
  closedAt: IsoDate | null
}

export interface PaymentReceiptDocumentData {
  /** `R-00000042`. */
  receiptNumber: string
  voided: boolean
  voidReason: string | null
  voidedAt: IsoDate | null
  paidAt: IsoDate
  renter: PartyData | null
  property: string | null
  installmentPeriod: Period
  /** Lo realmente entregado. */
  paidCurrency: DocumentCurrency
  amount: string
  /** Si la moneda de pago difiere de la de la cuota. */
  exchange: {
    rate: string
    source: string
    date: IsoDate
    equivalent: string
  } | null
  contractCurrency: DocumentCurrency
  /** `TRANSFER | CASH | CREDIT | OTHER | DEPOSIT`. */
  method: string
  /** `AGENCY | OWNER`. */
  receivedBy: string
  allocation: {
    lateFee: string
    rent: string
    charges: string
    creditGenerated: string
  }
  remaining: { total: string; rent: string; lateFee: string; charges: string }
  registeredBy: string | null
  notes: string | null
}

export interface TerminationNoticeDocumentData {
  property: string | null
  owner: PartyData | null
  renter: PartyData | null
  currency: DocumentCurrency
  startDate: IsoDate
  endDate: IsoDate
  notifiedAt: IsoDate
  terminatedAt: IsoDate
  currentRent: string
  remainingMonths: number
  remainingDays: number
  totalDays: number
  futureRent: string
  penaltyPercent: string
  penalty: string
  deposit: string
  depositCurrency: DocumentCurrency
  /** `FIXED | FOLLOWS_RENT | MANUAL`. */
  depositReturnMode: string
}

export type DocumentData =
  | SettlementDocumentData
  | OwnerStatementDocumentData
  | PaymentReceiptDocumentData
  | TerminationNoticeDocumentData

/** Carpeta del archivo dentro del tenant (`documents/<carpeta>/<id>-<versión>.pdf`). */
export const STORAGE_FOLDER: Record<DocumentKind, string> = {
  [DocumentKind.SETTLEMENT]: 'settlement',
  [DocumentKind.OWNER_STATEMENT]: 'owner-statement',
  [DocumentKind.PAYMENT_RECEIPT]: 'payment-receipt',
  [DocumentKind.TERMINATION_NOTICE]: 'termination-notice',
}

/** Qué tipo de entidad cuelga el aviso `DOCUMENT_FAILED`. */
export const ENTITY_TYPE: Record<DocumentKind, string> = {
  [DocumentKind.SETTLEMENT]: 'settlement',
  [DocumentKind.OWNER_STATEMENT]: 'owner_statement',
  [DocumentKind.PAYMENT_RECEIPT]: 'payment',
  [DocumentKind.TERMINATION_NOTICE]: 'contract',
}
