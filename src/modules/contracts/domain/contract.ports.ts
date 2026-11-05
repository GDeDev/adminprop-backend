import { IsoDate } from '@/shared/dates/calendar-date'
import {
  CollectionMode,
  Contract,
  ContractStatus,
  Currency,
  DepositReturnMode,
  FeeMode,
  RentIndex,
  RentUpdateFrequency,
  RentUpdateSource,
  RentUpdateType,
  Surety,
} from './contract'

/** Lo que define un contrato al nacer. Montos como string decimal. */
export interface NewContract {
  propertyId: string
  ownerId: string
  renterId: string
  guarantorId: string | null
  startDate: IsoDate
  endDate: IsoDate
  initialRent: string
  currency: Currency
  rentUpdateType: RentUpdateType
  rentUpdateFrequency: RentUpdateFrequency
  deposit: string
  depositCurrency: Currency
  depositReturnMode: DepositReturnMode
  fixedIncreasePercentage: string | null
  feePercentage: string
  notes: string | null
  surety: SuretyData
  renewedFromId: string | null
  /** Sólo una migración crea contratos ya terminados; el resto nace `ACTIVE`. */
  status?: ContractStatus
  /** La primera fila de términos, vigente desde `startDate` (D-70). */
  billingTerms: NewBillingTerms
}

/** Los términos de cobro, sin fecha ni autor. Montos como string decimal. */
export interface NewBillingTerms {
  collectionMode: CollectionMode
  feeMode: FeeMode
  feePercentage: string
  feeAmount: string | null
  lateFeePercentage: string | null
  lateFeeGraceDays: number | null
}

/** Una fila nueva de términos (D-70). */
export interface BillingTermsChange extends NewBillingTerms {
  effectiveFrom: IsoDate
  notes: string | null
  changedById: string | null
}

/** La caución sin los archivos: los PDFs tienen su propio endpoint. */
export type SuretyData = Omit<Surety, 'policyPdfKey' | 'policyPdfUrl'>

/** Lo único editable después de creado (spec 3.1; D-55). */
export interface ContractChanges {
  notes?: string | null
  guarantorId?: string | null
  surety?: SuretyData
  depositReturnMode?: DepositReturnMode
}

export interface NewRentUpdate {
  effectiveFrom: IsoDate
  previousRent: string
  newRent: string
  source: RentUpdateSource
  indexType: RentIndex | null
  indexFromPeriod: string | null
  indexToPeriod: string | null
  indexFromValue: string | null
  indexToValue: string | null
  fixedPercentage: string | null
  appliedById: string | null
  /** Sólo en el ajuste manual (D-230). */
  adjustmentReason?: string | null
  authorizedBy?: string | null
}

export interface TerminationData {
  terminatedAt: IsoDate
  notifiedAt: IsoDate
  penalty: string
  futureRent: string
}

export type ContractDocumentKind = 'contract' | 'policy'

export interface ContractFilter {
  status?: ContractStatus
  propertyId?: string
  renterId?: string
  ownerId?: string
  /** Activos que terminan entre las dos fechas, inclusive (por vencer). */
  endDateBetween?: { from: IsoDate; to: IsoDate }
}

/**
 * Puerto del repositorio. Todo corre dentro del tenant del contexto. Los
 * contratos nunca se borran: no hay `delete`.
 */
export abstract class ContractRepository {
  /** Crea el contrato y la fila inicial del historial del alquiler. */
  abstract create(data: NewContract): Promise<Contract>

  abstract findById(id: string): Promise<Contract | null>

  abstract findActiveByProperty(propertyId: string): Promise<Contract | null>

  /** Más nuevos primero. */
  abstract list(
    filter: ContractFilter,
    page: { skip: number; take: number },
  ): Promise<[Contract[], number]>

  /** Todos los que cumplen el filtro, sin paginar (reportes de la Fase 19). */
  abstract listAll(filter: ContractFilter): Promise<Contract[]>

  /** Activos; con `endingBefore`, sólo los que terminaron antes de esa fecha. */
  abstract listActive(options?: { endingBefore?: IsoDate }): Promise<Contract[]>

  /**
   * Activos cuya vigencia `[startDate, endDate]` toca algún día del rango
   * `[from, to]`, inclusive. Para generar las cuotas de un mes.
   */
  abstract listActiveCovering(from: IsoDate, to: IsoDate): Promise<Contract[]>

  abstract update(id: string, changes: ContractChanges): Promise<Contract>

  abstract setDocument(
    id: string,
    kind: ContractDocumentKind,
    file: { key: string; url: string },
  ): Promise<Contract>

  abstract addRentUpdate(
    contractId: string,
    update: NewRentUpdate,
  ): Promise<Contract>

  /** Agrega una fila de términos de cobro; las anteriores no se tocan. */
  abstract addBillingTerms(
    contractId: string,
    terms: BillingTermsChange,
  ): Promise<Contract>

  abstract terminate(id: string, data: TerminationData): Promise<Contract>

  /** Guarda el PDF del cálculo de la rescisión (Fase 15). */
  abstract attachTerminationPdf(
    id: string,
    file: { key: string; url: string },
  ): Promise<void>

  abstract setStatus(id: string, status: ContractStatus): Promise<Contract>
}
