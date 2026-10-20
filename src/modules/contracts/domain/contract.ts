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

/** Cada cuántos meses (PRD 5.5: mensual / trimestral / cuatrimestral). */
export enum RentUpdateFrequency {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  FOUR_MONTHLY = 'FOUR_MONTHLY',
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
  /** Null si lo aplicó el cron. */
  appliedById: string | null
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
  /** Estático: no sigue a los aumentos (A-1). */
  deposit: string
  /** En %, fijado al crear (spec Fase 9, 4). */
  feePercentage: string
  status: ContractStatus
  contractPdfKey: string | null
  contractPdfUrl: string | null
  notes: string | null
  surety: Surety
  termination: Termination | null
  renewedFromId: string | null
  /** Del más reciente al más viejo. Nunca vacío: siempre está el inicial. */
  rentUpdates: RentUpdate[]
  createdAt: Date
  updatedAt: Date
}

/** El alquiler vigente: la última fila del historial. */
export function currentRentOf(contract: Contract): string {
  return contract.rentUpdates[0].newRent
}
