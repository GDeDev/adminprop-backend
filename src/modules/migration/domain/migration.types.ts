/** Coinciden con los enums de Prisma (`schema.prisma`, Fase 21). */
export enum ImportSource {
  EXCEL = 'EXCEL',
  TOKKO = 'TOKKO',
}

export enum ImportBatchMode {
  DRY_RUN = 'DRY_RUN',
  IMPORT = 'IMPORT',
}

export enum ImportBatchStatus {
  ANALYZING = 'ANALYZING',
  READY = 'READY',
  IMPORTING = 'IMPORTING',
  COMPLETED = 'COMPLETED',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
  DISCARDED = 'DISCARDED',
}

export enum ImportEntity {
  OWNER = 'OWNER',
  RENTER = 'RENTER',
  GUARANTOR = 'GUARANTOR',
  PROPERTY = 'PROPERTY',
  CONTRACT = 'CONTRACT',
}

/** Orden en que se importa: cada entidad sólo depende de las anteriores. */
export const IMPORT_ORDER: ImportEntity[] = [
  ImportEntity.OWNER,
  ImportEntity.GUARANTOR,
  ImportEntity.RENTER,
  ImportEntity.PROPERTY,
  ImportEntity.CONTRACT,
]

export enum ImportRowStatus {
  VALID = 'VALID',
  ERROR = 'ERROR',
  CONFLICT = 'CONFLICT',
  ALREADY_IMPORTED = 'ALREADY_IMPORTED',
  IMPORTED = 'IMPORTED',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
}

export enum ImportResolution {
  SKIP = 'SKIP',
  MERGE_EMPTY_FIELDS = 'MERGE_EMPTY_FIELDS',
}

export enum ImportAssetStatus {
  PENDING = 'PENDING',
  MIGRATED = 'MIGRATED',
  FAILED = 'FAILED',
}

/** Una vez confirmado (o cerrado) el lote ya no se edita. */
export const FINAL_BATCH_STATUSES: ImportBatchStatus[] = [
  ImportBatchStatus.COMPLETED,
  ImportBatchStatus.PARTIAL,
  ImportBatchStatus.FAILED,
  ImportBatchStatus.DISCARDED,
]

export interface RowError {
  field: string
  code: string
  message: string
}

export type ConflictKind = 'EXISTING' | 'DUPLICATE_IN_FILE'

export interface RowConflict {
  /** La entidad existente; en un duplicado del archivo, la fila que lo pisa. */
  entityId: string
  reason: string
  differingFields: string[]
  kind: ConflictKind
}

// ------------------------------------------------------------- Datos de fila

export interface PersonRowData {
  firstName: string
  lastName: string
  nationalId: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
}

export interface OwnerRowData extends PersonRowData {
  cbu: string | null
  alias: string | null
  bankName: string | null
  holder: string | null
}

export interface RenterRowData extends PersonRowData {
  /** DNI del garante: está en la hoja de garantes o ya en el sistema. */
  guarantorNationalId: string | null
}

export interface GuarantorRowData extends PersonRowData {
  guaranteeType: 'PROPERTY' | 'PAYSLIPS'
  guaranteeDetail: string
}

export interface PropertyPhotoSource {
  url: string
  position: number
}

export interface PropertyRowData {
  /** Clave de enlace con la hoja de contratos (sólo Excel). */
  code: string | null
  address: string
  /** Ruta de la ubicación, de lo general a lo particular. Vacía: sin ubicación. */
  locationPath: string[]
  /** La ubicación existente, si la ruta ya está cargada. */
  locationId: string | null
  propertyTypeName: string
  propertyTypeId: string | null
  ownerNationalId: string | null
  amenityNames: string[]
  listingPrice: string | null
  listingCurrency: 'ARS' | 'USD' | null
  publicDescription: string | null
  notes: string | null
  /** Fotos de Tokko a traer al storage propio. */
  photos: PropertyPhotoSource[]
}

export interface ContractRowData {
  /** Código de la propiedad en la hoja de propiedades del mismo archivo. */
  propertyCode: string
  /** Dirección de la propiedad (para mostrar y para el vínculo). */
  propertyLabel: string
  renterNationalId: string
  startDate: string
  endDate: string
  initialRent: string
  currency: 'ARS' | 'USD'
  rentUpdateType: 'ICL' | 'IPC' | 'FIXED' | 'OTHER'
  rentUpdateFrequency:
    'MONTHLY' | 'QUARTERLY' | 'FOUR_MONTHLY' | 'SEMIANNUAL' | 'ANNUAL'
  fixedIncreasePercentage: string | null
  deposit: string
  depositCurrency: 'ARS' | 'USD'
  collectionMode: 'AGENCY' | 'OWNER_DIRECT'
  notes: string | null
}

export type RowData =
  | OwnerRowData
  | RenterRowData
  | GuarantorRowData
  | PropertyRowData
  | ContractRowData

export interface ImportRow {
  id: string
  batchId: string
  entity: ImportEntity
  rowNumber: number | null
  externalId: string | null
  naturalKey: string
  label: string
  status: ImportRowStatus
  data: RowData
  errors: RowError[]
  conflict: RowConflict | null
  resolution: ImportResolution | null
  excluded: boolean
  targetId: string | null
  needsReview: boolean
}

/** Lo que el análisis inserta (el id lo genera el análisis: un duplicado lo referencia). */
export type NewImportRow = Omit<ImportRow, 'batchId'>

export interface MastersCount {
  locations: number
  propertyTypes: number
  amenities: number
}

export interface BatchSummary {
  /**
   * Cómo termina el lote cuando se bajan las fotos: mientras tanto sigue
   * `IMPORTING` (la pantalla consulta el lote hasta que deja de estarlo).
   */
  finalStatus?: ImportBatchStatus
  missingSheets: string[]
  mastersToCreate: MastersCount
  mastersCreated: MastersCount
}

export interface BatchOptions {
  /** Excel: dónde quedó el archivo subido. */
  fileUrl?: string
  /** Tokko: lo pedido al analizar. */
  operationTypes?: string[]
  limit?: number
  includeAssets?: boolean
  /** Lo elegido al confirmar. */
  defaultConflictResolution?: ImportResolution
  migrateAssets?: boolean
}

export interface ImportBatch {
  id: string
  source: ImportSource
  mode: ImportBatchMode
  status: ImportBatchStatus
  fileName: string | null
  fileKey: string | null
  analysisJobId: string | null
  importJobId: string | null
  summary: BatchSummary | null
  options: BatchOptions
  errorMessage: string | null
  createdById: string | null
  confirmedById: string | null
  confirmedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ImportAssetResult {
  id: string
  batchId: string
  propertyId: string
  sourceUrl: string
  position: number
  status: ImportAssetStatus
  error: string | null
  storageKey: string | null
}

export interface EntityCounts {
  total: number
  valid: number
  errors: number
  conflicts: number
  imported: number
}
