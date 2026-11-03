import { QueueDefinition } from '@/platform/queue/queue.port'

/** Colas de la migración (Fase 21). Cada mensaje corre dentro del tenant que lo publicó. */
export const MIGRATION_ANALYZE_QUEUE: QueueDefinition = {
  name: 'migration-analyze',
  // Un análisis que falla queda FAILED con su motivo: no se reintenta solo.
  retryLimit: 0,
}

export const MIGRATION_IMPORT_QUEUE: QueueDefinition = {
  name: 'migration-import',
  retryLimit: 0,
}

export const MIGRATION_ASSETS_QUEUE: QueueDefinition = {
  name: 'migration-assets',
  retryLimit: 1,
}

export interface MigrationJobPayload {
  batchId: string
  jobId: string
}

export const ANALYZE_JOB_TYPE = 'migration-analyze'
export const IMPORT_JOB_TYPE = 'migration-import'
export const ASSETS_JOB_TYPE = 'migration-assets'
