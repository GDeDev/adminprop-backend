import { Injectable } from '@nestjs/common'

import { MigrationFacade, STALE_BATCH_DAYS } from '@/modules/migration/public'
import { JobName } from '../../domain/job-catalog'
import { AutomationJob, JobOutcome } from '../job.types'

/**
 * Descarta los lotes de migración que esperan su revisión hace más de 7 días
 * y borra el archivo subido (Fase 21, A-79). Ya es idempotente: un lote
 * descartado no vuelve a aparecer.
 */
@Injectable()
export class DiscardStaleImportBatchesJob implements AutomationJob {
  readonly name = JobName.MIGRATION_DISCARD_STALE

  constructor(private readonly migration: MigrationFacade) {}

  async run(): Promise<JobOutcome> {
    const discarded = await this.migration.discardStaleBatches()
    return {
      affected: discarded,
      summary:
        discarded === 0
          ? 'Ningún lote de migración vencido'
          : `${discarded} lotes de migración descartados (más de ${STALE_BATCH_DAYS} días sin confirmar)`,
    }
  }
}
