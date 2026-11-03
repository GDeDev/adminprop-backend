import { Injectable } from '@nestjs/common'

import { AuditFacade } from '@/modules/audit/public'
import { AsyncJobsFacade } from '@/modules/jobs/public'
import { StoragePort } from '@/platform/storage/storage.port'
import { createLogger } from '@/shared/logging/root-logger'
import {
  ImportBatchRepository,
  ImportRowRepository,
} from '../domain/migration.ports'
import {
  ImportBatch,
  ImportBatchStatus,
  ImportSource,
} from '../domain/migration.types'
import { ExcelReader } from './excel-reader'
import { AnalysisResult, ImportAnalyzer } from './import-analyzer'
import { MigrationJobPayload } from './migration-queues'
import { userMessage } from './user-message'

/**
 * Corre el análisis (dry-run) de un lote en la cola. Si falla —la key de
 * Tokko es inválida, el archivo no se pudo leer—, el lote queda `FAILED` con
 * el motivo y sin filas parciales (rediseño 4.3).
 */
@Injectable()
export class AnalysisRunner {
  private readonly logger = createLogger('AnalysisRunner')

  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly rows: ImportRowRepository,
    private readonly analyzer: ImportAnalyzer,
    private readonly reader: ExcelReader,
    private readonly storage: StoragePort,
    private readonly jobs: AsyncJobsFacade,
    private readonly audit: AuditFacade,
  ) {}

  async run({ batchId, jobId }: MigrationJobPayload): Promise<void> {
    const batch = await this.batches.findById(batchId)
    if (!batch || batch.status !== ImportBatchStatus.ANALYZING) {
      await this.jobs.fail(jobId, 'El lote no está en análisis')
      return
    }
    await this.jobs.markProcessing(jobId)

    try {
      const result = await this.analyze(batch)
      await this.rows.insertMany(batch.id, result.rows)
      await this.batches.update(batch.id, {
        status: ImportBatchStatus.READY,
        summary: result.summary,
      })
      await this.jobs.complete(jobId, {
        batchId: batch.id,
        rows: result.rows.length,
      })
      await this.audit.record({
        action: 'JOB_RUN',
        entity: 'ImportBatch',
        entityId: batch.id,
        summary: `Analizó un lote de migración (${result.rows.length} filas)`,
        changes: { source: { after: batch.source } },
      })
    } catch (error) {
      const { code, message } = userMessage(error)
      if (code === 'UNEXPECTED_ERROR') {
        this.logger.error({ err: error, batchId }, 'Falló el análisis del lote')
      }
      await this.rows.deleteByBatch(batch.id)
      await this.batches.update(batch.id, {
        status: ImportBatchStatus.FAILED,
        errorMessage: message.slice(0, 500),
      })
      await this.deleteFile(batch)
      await this.jobs.fail(jobId, message)
    }
  }

  private async analyze(batch: ImportBatch): Promise<AnalysisResult> {
    if (batch.source === ImportSource.TOKKO) {
      return this.analyzer.analyzeTokko(batch.options)
    }
    if (!batch.fileKey) throw new Error('El lote de Excel no tiene archivo')
    const buffer = await this.storage.download(
      batch.fileKey,
      batch.options.fileUrl ?? '',
    )
    return this.analyzer.analyzeExcel(await this.reader.read(buffer))
  }

  private async deleteFile(batch: ImportBatch): Promise<void> {
    if (!batch.fileKey) return
    try {
      await this.storage.delete(batch.fileKey)
      await this.batches.update(batch.id, { fileKey: null })
    } catch (error) {
      this.logger.warn({ err: error }, 'No se pudo borrar el archivo del lote')
    }
  }
}
