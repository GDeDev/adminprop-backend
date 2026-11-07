import { IsoDate } from '@/shared/dates/calendar-date'

/** Coinciden con los enums de Prisma. */
export enum Currency {
  ARS = 'ARS',
  USD = 'USD',
}

/** Cómo se actualiza el alquiler (PRD 5.5: ICL / IPC / Fijo / Otro). */
export enum RentUpdateType {
  ICL = 'ICL',
  IPC = 'IPC',
  FIXED = 'FIXED',
  OTHER = 'OTHER',
}

/**
 * Cada cuántos meses (PRD 5.5: mensual / trimestral / cuatrimestral; Micaela
 * #8 sumó semestral y anual).
 */
export enum RentUpdateFrequency {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  FOUR_MONTHLY = 'FOUR_MONTHLY',
  SEMIANNUAL = 'SEMIANNUAL',
  ANNUAL = 'ANNUAL',
}

/** Cómo se devuelve el depósito al terminar (Micaela #1). */
export enum DepositReturnMode {
  /** Se devuelve lo recibido. */
  FIXED = 'FIXED',
  /** El equivalente al alquiler vigente al terminar. */
  FOLLOWS_RENT = 'FOLLOWS_RENT',
  /** Se define a mano al cerrar las cuentas (Fase 12). */
  MANUAL = 'MANUAL',
}

/** Quién cobra el alquiler (Micaela #9). */
export enum CollectionMode {
  AGENCY = 'AGENCY',
  OWNER_DIRECT = 'OWNER_DIRECT',
}

/** Cómo cobra sus honorarios la inmobiliaria (Micaela #10). */
export enum FeeMode {
  /** Los descuenta de lo cobrado al liquidar. */
  DEDUCTED = 'DEDUCTED',
  /** El propietario los paga después. */
  OWNER_PAYS = 'OWNER_PAYS',
  /** El inquilino los paga aparte, por cuenta del propietario. */
  RENTER_PAYS_ON_BEHALF = 'RENTER_PAYS_ON_BEHALF',
}

export enum ContractStatus {
  ACTIVE = 'ACTIVE',
  FINISHED = 'FINISHED',
  TERMINATED = 'TERMINATED',
}

export enum RentUpdateSource {
  INITIAL = 'INITIAL',
  INDEX = 'INDEX',
  MANUAL = 'MANUAL',
}

/** Los tipos de actualización que usan un índice público. */
export type RentIndex = 'ICL' | 'IPC'

/**
 * Una fila del historial del alquiler. La primera es el canon inicial; el
 * vigente es la de mayor `effectiveFrom` (D-53). Montos como string decimal.
 */
export interface RentUpdate {
  id: string
  effectiveFrom: IsoDate
  previousRent: string | null
  newRent: string
  source: RentUpdateSource
  indexType: RentIndex | null
  /** `AAAA-MM` del valor anterior y del nuevo, con los valores usados. */
  indexFromPeriod: string | null
  indexToPeriod: string | null
  indexFromValue: string | null
  indexToValue: string | null
  /** El % fijo aplicado (FIXED con `fixedIncreasePercentage`); null si no. */
  fixedPercentage: string | null
  /** Null si lo aplicó el cron. */
  appliedById: string | null
  /** Ajuste manual (D-230): motivo y autorizante; null en los automáticos. */
  adjustmentReason: string | null
  authorizedBy: string | null
  createdAt: Date
}

/**
 * Una fila de los términos de cobro (D-70): vigencias que nunca se pisan.
 * `lateFeePercentage` y `lateFeeGraceDays` en null heredan los del tenant.
 * Montos como string decimal.
 */
export interface BillingTerms {
  id: string
  effectiveFrom: IsoDate
  collectionMode: CollectionMode
  feeMode: FeeMode
  /** % de honorarios vigente. */
  feePercentage: string
  /** Importe fijo de honorarios; si está, manda sobre el %. */
  feeAmount: string | null
  lateFeePercentage: string | null
  lateFeeGraceDays: number | null
  notes: string | null
  /** Null en la fila inicial. */
  changedById: string | null
  createdAt: Date
}

/** Lo que el contrato puede heredar de la inmobiliaria en los términos. */
export interface LateFeeDefaults {
  /** Punitorio diario, en %, como string decimal. Null: la inmobiliaria no fijó uno (D-228). */
  dailyLateFeePercentage: string | null
  /** Días del mes sin punitorio: del 1 al N. */
  paymentGraceDays: number
}

/** Términos con los fallbacks del tenant ya resueltos. */
export interface ResolvedBillingTerms {
  id: string
  effectiveFrom: IsoDate
  collectionMode: CollectionMode
  feeMode: FeeMode
  feePercentage: string
  feeAmount: string | null
  lateFeePercentage: string
  lateFeeGraceDays: number
  /** Día del mes desde el que corre el punitorio: gracia + 1 (D-228). */
  lateFeeStartDay: number
  inheritedLateFeePercentage: boolean
  inheritedLateFeeGraceDays: boolean
  notes: string | null
  changedById: string | null
  createdAt: Date
}

/** Seguro de caución (PRD 5.5). */
export interface Surety {
  hasSurety: boolean
  insurerName: string | null
  insurerAlertEmail: string | null
  policyNumber: string | null
  policyExpiresAt: IsoDate | null
  policyPdfKey: string | null
  policyPdfUrl: string | null
}

/** Lo que se calculó y guardó al rescindir (RN-09). */
export interface Termination {
  terminatedAt: IsoDate
  notifiedAt: IsoDate
  penalty: string
  futureRent: string
}

/** Contrato de alquiler (PRD 5.5). */
export interface Contract {
  id: string
  propertyId: string
  ownerId: string
  renterId: string
  guarantorId: string | null
  startDate: IsoDate
  /** Último día del contrato, inclusive. */
  endDate: IsoDate
  initialRent: string
  currency: Currency
  rentUpdateType: RentUpdateType
  rentUpdateFrequency: RentUpdateFrequency
  /** Por el importe y la moneda recibidos (Micaela #1). */
  deposit: string
  depositCurrency: Currency
  depositReturnMode: DepositReturnMode
  /** Con `rentUpdateType = FIXED`, el % que se aplica solo en cada aumento. */
  fixedIncreasePercentage: string | null
  /** En %, fijado al crear (spec Fase 9, 4). El vigente está en `billingTerms`. */
  feePercentage: string
  status: ContractStatus
  contractPdfKey: string | null
  contractPdfUrl: string | null
  notes: string | null
  surety: Surety
  termination: Termination | null
  /** PDF del cálculo de la rescisión (Fase 15). */
  terminationPdfKey: string | null
  terminationPdfUrl: string | null
  renewedFromId: string | null
  /** Del más reciente al más viejo. Nunca vacío: siempre está el inicial. */
  rentUpdates: RentUpdate[]
  /** Del más reciente al más viejo. Nunca vacío: la primera nace con el contrato. */
  billingTerms: BillingTerms[]
  createdAt: Date
  updatedAt: Date
}

/** El alquiler vigente: la última fila del historial. */
export function currentRentOf(contract: Contract): string {
  return contract.rentUpdates[0].newRent
}

/**
 * Los términos vigentes a una fecha: la fila más nueva con `effectiveFrom`
 * ≤ fecha. Antes de la primera (no debería pasar: nace con el inicio) rige
 * la primera.
 */
export function billingTermsInForce(
  terms: BillingTerms[],
  date: IsoDate,
): BillingTerms {
  return terms.find((t) => t.effectiveFrom <= date) ?? terms[terms.length - 1]
}
