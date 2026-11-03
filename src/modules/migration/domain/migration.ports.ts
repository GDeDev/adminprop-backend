import {
  BatchOptions,
  BatchSummary,
  ImportAssetResult,
  ImportAssetStatus,
  ImportBatch,
  ImportBatchStatus,
  ImportEntity,
  ImportResolution,
  ImportRow,
  ImportRowStatus,
  ImportSource,
  NewImportRow,
  RowConflict,
  RowError,
} from './migration.types'

export interface NewImportBatch {
  source: ImportSource
  fileName: string | null
  fileKey: string | null
  options: BatchOptions
}

export interface ImportBatchChanges {
  status?: ImportBatchStatus
  mode?: 'DRY_RUN' | 'IMPORT'
  summary?: BatchSummary
  options?: BatchOptions
  errorMessage?: string | null
  fileKey?: string | null
  analysisJobId?: string
  importJobId?: string
  confirmedById?: string | null
  confirmedAt?: Date
}

export interface ImportBatchFilter {
  source?: ImportSource
  status?: ImportBatchStatus
}

/** Puerto del repositorio de lotes. Todo corre dentro del tenant del contexto. */
export abstract class ImportBatchRepository {
  abstract create(data: NewImportBatch): Promise<ImportBatch>

  abstract findById(id: string): Promise<ImportBatch | null>

  /** Más nuevos primero. */
  abstract list(
    filter: ImportBatchFilter,
    page: { skip: number; take: number },
  ): Promise<[ImportBatch[], number]>

  abstract update(id: string, changes: ImportBatchChanges): Promise<ImportBatch>

  /**
   * Cambia el estado sólo si sigue siendo `from`; devuelve si lo logró. Es lo
   * que impide confirmar dos veces el mismo lote con dos pedidos a la vez.
   */
  abstract transition(
    id: string,
    from: ImportBatchStatus,
    changes: ImportBatchChanges,
  ): Promise<boolean>

  /** Los `READY` sin tocar desde antes de esa fecha. */
  abstract listStaleReady(before: Date): Promise<ImportBatch[]>
}

export interface ImportRowFilter {
  entity?: ImportEntity
  status?: ImportRowStatus
  needsReview?: boolean
}

export interface ImportRowChanges {
  status?: ImportRowStatus
  resolution?: ImportResolution | null
  excluded?: boolean
  targetId?: string | null
  errors?: RowError[]
  conflict?: RowConflict | null
  needsReview?: boolean
}

export interface RowCountGroup {
  entity: ImportEntity
  status: ImportRowStatus
  needsReview: boolean
  count: number
}

export abstract class ImportRowRepository {
  abstract insertMany(batchId: string, rows: NewImportRow[]): Promise<void>

  abstract deleteByBatch(batchId: string): Promise<void>

  abstract findById(batchId: string, id: string): Promise<ImportRow | null>

  /** Ordenadas por entidad (en el orden de importación) y fila. */
  abstract list(
    batchId: string,
    filter: ImportRowFilter,
    page: { skip: number; take: number },
  ): Promise<[ImportRow[], number]>

  /** Todas las del lote (o de una entidad), para importar o armar el reporte. */
  abstract listAll(batchId: string, entity?: ImportEntity): Promise<ImportRow[]>

  abstract update(id: string, changes: ImportRowChanges): Promise<ImportRow>

  abstract countGroups(batchId: string): Promise<RowCountGroup[]>
}

export abstract class ImportLinkRepository {
  /** `externalKey → targetId` de los que ya se importaron. */
  abstract findTargets(
    source: ImportSource,
    entity: ImportEntity,
    externalKeys: string[],
  ): Promise<Map<string, string>>

  /** Idempotente: si el vínculo ya existe, no hace nada. */
  abstract link(data: {
    source: ImportSource
    entity: ImportEntity
    externalKey: string
    targetId: string
    batchId: string
  }): Promise<void>
}

export interface NewImportAsset {
  propertyId: string
  sourceUrl: string
  position: number
}

export abstract class ImportAssetRepository {
  abstract insertMany(batchId: string, items: NewImportAsset[]): Promise<void>

  abstract list(
    batchId: string,
    status?: ImportAssetStatus,
  ): Promise<ImportAssetResult[]>

  abstract update(
    id: string,
    changes: {
      status: ImportAssetStatus
      error?: string | null
      storageKey?: string | null
    },
  ): Promise<void>

  /** Vuelve a `PENDING` las fotos que fallaron; devuelve cuántas. */
  abstract resetFailed(batchId: string): Promise<number>

  abstract countByStatus(
    batchId: string,
  ): Promise<Record<ImportAssetStatus, number>>

  /** Cuántas fotos migró y cuántas fallaron cada propiedad del lote. */
  abstract countByProperty(
    batchId: string,
  ): Promise<Map<string, { migrated: number; failed: number }>>
}
