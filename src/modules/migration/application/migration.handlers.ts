import {
  CommandHandler,
  ICommandHandler,
  IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs'

import { AuditFacade } from '@/modules/audit/public'
import { AsyncJobsFacade } from '@/modules/jobs/public'
import { QueuePort } from '@/platform/queue/queue.port'
import { StoragePort } from '@/platform/storage/storage.port'
import { RequestContext } from '@/shared/context/request-context'
import { PaginatedResult } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import {
  BatchAlreadyConfirmedException,
  BatchNotImportedException,
  BatchNotReadyException,
  ImportBatchNotFoundException,
  ImportRowNotFoundException,
  InvalidResolutionException,
} from '../domain/migration.exceptions'
import {
  ImportAssetRepository,
  ImportBatchRepository,
  ImportRowRepository,
} from '../domain/migration.ports'
import {
  ImportBatch,
  ImportBatchMode,
  ImportBatchStatus,
  ImportRowStatus,
  ImportSource,
} from '../domain/migration.types'
import {
  ImportBatchDetailView,
  ImportBatchSummaryView,
  ImportBatchViews,
  ImportRowView,
} from './batch.views'
import { BatchDiscarder } from './batch-discarder'
import { ExcelReader } from './excel-reader'
import { ExcelTemplateService } from './excel-template.service'
import { ImportExecutor } from './import-executor'
import { ImportReportService } from './import-report.service'
import {
  ANALYZE_JOB_TYPE,
  IMPORT_JOB_TYPE,
  MIGRATION_ANALYZE_QUEUE,
  MIGRATION_IMPORT_QUEUE,
} from './migration-queues'
import {
  ConfirmImportCommand,
  DiscardImportCommand,
  GetExcelTemplateQuery,
  GetImportBatchQuery,
  GetImportReportQuery,
  ListImportBatchesQuery,
  ListImportRowsQuery,
  RetryImportAssetsCommand,
  StartExcelAnalysisCommand,
  StartTokkoAnalysisCommand,
  UpdateImportRowCommand,
} from './migration.commands'

export interface StartedMigration {
  batchId: string
  jobId: string
}

async function requireBatch(
  batches: ImportBatchRepository,
  id: string,
): Promise<ImportBatch> {
  const batch = await batches.findById(id)
  if (!batch) throw new ImportBatchNotFoundException(id)
  return batch
}

/** Nombre del archivo para mostrar: sin carpetas y de largo acotado. */
function displayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  return base.trim().slice(0, 255) || 'archivo.xlsx'
}

/**
 * Sube el .xlsx, valida lo que se puede validar en el pedido (formato,
 * versión de la plantilla, tamaño) y encola el análisis. El análisis en sí
 * corre en la cola (A-70).
 */
@CommandHandler(StartExcelAnalysisCommand)
export class StartExcelAnalysisHandler implements ICommandHandler<
  StartExcelAnalysisCommand,
  StartedMigration
> {
  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly reader: ExcelReader,
    private readonly storage: StoragePort,
    private readonly jobs: AsyncJobsFacade,
    private readonly queue: QueuePort,
  ) {}

  async execute({
    file,
  }: StartExcelAnalysisCommand): Promise<StartedMigration> {
    // Falla acá, en el pedido, con 422: formato, versión y cantidad de filas.
    await this.reader.read(file.buffer)

    const batch = await this.batches.create({
      source: ImportSource.EXCEL,
      fileName: displayName(file.originalName),
      fileKey: null,
      options: {},
    })
    const stored = await this.storage.upload(
      file.buffer,
      `migrations/${batch.id}.xlsx`,
      {
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    )
    const jobId = await this.jobs.start(ANALYZE_JOB_TYPE)
    await this.batches.update(batch.id, {
      fileKey: stored.key,
      options: { fileUrl: stored.url },
      analysisJobId: jobId,
    })
    await this.queue.publish(MIGRATION_ANALYZE_QUEUE, {
      batchId: batch.id,
      jobId,
    })
    return { batchId: batch.id, jobId }
  }
}

@CommandHandler(StartTokkoAnalysisCommand)
export class StartTokkoAnalysisHandler implements ICommandHandler<
  StartTokkoAnalysisCommand,
  StartedMigration
> {
  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly jobs: AsyncJobsFacade,
    private readonly queue: QueuePort,
  ) {}

  async execute({
    options,
  }: StartTokkoAnalysisCommand): Promise<StartedMigration> {
    const batch = await this.batches.create({
      source: ImportSource.TOKKO,
      fileName: null,
      fileKey: null,
      options: {
        operationTypes: options.operationTypes?.length
          ? options.operationTypes
          : ['Rent'],
        limit: options.limit,
        includeAssets: options.includeAssets,
      },
    })
    const jobId = await this.jobs.start(ANALYZE_JOB_TYPE)
    await this.batches.update(batch.id, { analysisJobId: jobId })
    await this.queue.publish(MIGRATION_ANALYZE_QUEUE, {
      batchId: batch.id,
      jobId,
    })
    return { batchId: batch.id, jobId }
  }
}

/** Excluir una fila o elegir cómo resolver su conflicto, mientras el lote se revisa. */
@CommandHandler(UpdateImportRowCommand)
export class UpdateImportRowHandler implements ICommandHandler<
  UpdateImportRowCommand,
  ImportRowView
> {
  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly rows: ImportRowRepository,
    private readonly views: ImportBatchViews,
  ) {}

  async execute(command: UpdateImportRowCommand): Promise<ImportRowView> {
    const batch = await requireBatch(this.batches, command.batchId)
    if (batch.status !== ImportBatchStatus.READY) {
      throw new BatchNotReadyException(batch.status)
    }
    const row = await this.rows.findById(batch.id, command.rowId)
    if (!row) throw new ImportRowNotFoundException(command.rowId)

    const { excluded, resolution } = command.changes
    if (resolution !== undefined) {
      if (
        row.status !== ImportRowStatus.CONFLICT ||
        row.conflict?.kind !== 'EXISTING'
      ) {
        throw new InvalidResolutionException(
          'Sólo se elige cómo resolver una fila que choca con algo ya cargado',
        )
      }
    }
    const updated = await this.rows.update(row.id, {
      ...(excluded !== undefined ? { excluded } : {}),
      ...(resolution !== undefined ? { resolution } : {}),
    })
    return this.views.row(updated)
  }
}

/**
 * Confirma el lote ya revisado (A-70): importa exactamente esas filas. Sólo
 * desde `READY`; el cambio de estado es atómico, así dos pedidos a la vez no
 * importan dos veces.
 */
@CommandHandler(ConfirmImportCommand)
export class ConfirmImportHandler implements ICommandHandler<
  ConfirmImportCommand,
  StartedMigration
> {
  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly rows: ImportRowRepository,
    private readonly jobs: AsyncJobsFacade,
    private readonly queue: QueuePort,
    private readonly audit: AuditFacade,
  ) {}

  async execute({
    batchId,
    options,
  }: ConfirmImportCommand): Promise<StartedMigration> {
    const batch = await requireBatch(this.batches, batchId)
    if (batch.status !== ImportBatchStatus.READY) {
      throw [
        ImportBatchStatus.IMPORTING,
        ImportBatchStatus.COMPLETED,
        ImportBatchStatus.PARTIAL,
      ].includes(batch.status)
        ? new BatchAlreadyConfirmedException()
        : new BatchNotReadyException(batch.status)
    }

    const migrateAssets =
      options.migrateAssets ?? batch.options.includeAssets ?? false
    const moved = await this.batches.transition(
      batch.id,
      ImportBatchStatus.READY,
      {
        status: ImportBatchStatus.IMPORTING,
        mode: ImportBatchMode.IMPORT,
        confirmedById: RequestContext.userId ?? null,
        confirmedAt: new Date(),
        options: {
          ...batch.options,
          defaultConflictResolution: options.defaultConflictResolution,
          migrateAssets,
        },
      },
    )
    // Otro pedido ganó la carrera.
    if (!moved) throw new BatchAlreadyConfirmedException()

    const excluded = new Set(options.excludeRowIds)
    const rows = await this.rows.listAll(batch.id)
    for (const row of rows.filter((r) => excluded.has(r.id) && !r.excluded)) {
      await this.rows.update(row.id, { excluded: true })
    }
    const pending = rows.filter(
      (row) =>
        (row.status === ImportRowStatus.VALID ||
          row.status === ImportRowStatus.CONFLICT) &&
        !row.excluded &&
        !excluded.has(row.id),
    ).length

    const jobId = await this.jobs.start(IMPORT_JOB_TYPE, {
      totalItems: pending,
    })
    await this.batches.update(batch.id, { importJobId: jobId })
    await this.audit.record({
      action: 'JOB_RUN',
      entity: 'ImportBatch',
      entityId: batch.id,
      summary: `Confirmó la importación de un lote de migración (${pending} filas)`,
      changes: {
        source: { after: batch.source },
        rows: { after: pending },
        defaultConflictResolution: { after: options.defaultConflictResolution },
        migrateAssets: { after: migrateAssets },
        correlationId: { after: RequestContext.correlationId ?? null },
      },
    })
    await this.queue.publish(MIGRATION_IMPORT_QUEUE, {
      batchId: batch.id,
      jobId,
    })
    return { batchId: batch.id, jobId }
  }
}

/** Cierra el lote sin importar nada (y borra el archivo subido, A-79). */
@CommandHandler(DiscardImportCommand)
export class DiscardImportHandler implements ICommandHandler<
  DiscardImportCommand,
  ImportBatchDetailView
> {
  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly discarder: BatchDiscarder,
    private readonly audit: AuditFacade,
    private readonly views: ImportBatchViews,
  ) {}

  async execute({
    batchId,
  }: DiscardImportCommand): Promise<ImportBatchDetailView> {
    const batch = await requireBatch(this.batches, batchId)
    if (!(await this.discarder.discard(batch))) {
      throw new BatchNotReadyException(batch.status)
    }
    await this.audit.record({
      action: 'JOB_RUN',
      entity: 'ImportBatch',
      entityId: batch.id,
      summary: 'Descartó un lote de migración sin importar',
      changes: { status: { after: ImportBatchStatus.DISCARDED } },
    })
    return this.views.detail(await requireBatch(this.batches, batchId))
  }
}

/** Reintenta sólo las fotos que fallaron. */
@CommandHandler(RetryImportAssetsCommand)
export class RetryImportAssetsHandler implements ICommandHandler<
  RetryImportAssetsCommand,
  { jobId: string }
> {
  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly assets: ImportAssetRepository,
    private readonly executor: ImportExecutor,
  ) {}

  async execute({
    batchId,
  }: RetryImportAssetsCommand): Promise<{ jobId: string }> {
    const batch = await requireBatch(this.batches, batchId)
    if (
      batch.status !== ImportBatchStatus.COMPLETED &&
      batch.status !== ImportBatchStatus.PARTIAL
    ) {
      throw new BatchNotImportedException()
    }
    const retried = await this.assets.resetFailed(batch.id)
    const jobId = await this.executor.startAssets(batch.id, retried)
    return { jobId }
  }
}

// ------------------------------------------------------------------ Consultas

@QueryHandler(ListImportBatchesQuery)
export class ListImportBatchesHandler implements IQueryHandler<
  ListImportBatchesQuery,
  PaginatedResult<ImportBatchSummaryView>
> {
  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly views: ImportBatchViews,
  ) {}

  execute(
    query: ListImportBatchesQuery,
  ): Promise<PaginatedResult<ImportBatchSummaryView>> {
    return paginateWith(query.page, async (page) => {
      const [batches, total] = await this.batches.list(query.filter, page)
      return [await this.views.summaries(batches), total]
    })
  }
}

@QueryHandler(GetImportBatchQuery)
export class GetImportBatchHandler implements IQueryHandler<
  GetImportBatchQuery,
  ImportBatchDetailView
> {
  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly views: ImportBatchViews,
  ) {}

  async execute({
    batchId,
  }: GetImportBatchQuery): Promise<ImportBatchDetailView> {
    return this.views.detail(await requireBatch(this.batches, batchId))
  }
}

@QueryHandler(ListImportRowsQuery)
export class ListImportRowsHandler implements IQueryHandler<
  ListImportRowsQuery,
  PaginatedResult<ImportRowView>
> {
  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly rows: ImportRowRepository,
    private readonly views: ImportBatchViews,
  ) {}

  async execute(
    query: ListImportRowsQuery,
  ): Promise<PaginatedResult<ImportRowView>> {
    await requireBatch(this.batches, query.batchId)
    return paginateWith(query.page, async (page) => {
      const [rows, total] = await this.rows.list(
        query.batchId,
        query.filter,
        page,
      )
      return [rows.map((row) => this.views.row(row)), total]
    })
  }
}

@QueryHandler(GetExcelTemplateQuery)
export class GetExcelTemplateHandler implements IQueryHandler<
  GetExcelTemplateQuery,
  Buffer
> {
  constructor(private readonly template: ExcelTemplateService) {}

  execute(): Promise<Buffer> {
    return this.template.build()
  }
}

@QueryHandler(GetImportReportQuery)
export class GetImportReportHandler implements IQueryHandler<
  GetImportReportQuery,
  Buffer
> {
  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly report: ImportReportService,
  ) {}

  async execute({ batchId }: GetImportReportQuery): Promise<Buffer> {
    return this.report.build(await requireBatch(this.batches, batchId))
  }
}
