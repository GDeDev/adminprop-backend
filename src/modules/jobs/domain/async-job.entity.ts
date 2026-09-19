/**
 * Estados de un trabajo en background. Tienen que coincidir con el enum
 * `AsyncJobStatus` de `prisma/schema.prisma`.
 */
export enum AsyncJobStatus {
  Pending = 'PENDING',
  Processing = 'PROCESSING',
  Completed = 'COMPLETED',
  CompletedWithErrors = 'COMPLETED_WITH_ERRORS',
  Failed = 'FAILED',
}

export interface AsyncJob {
  id: string
  tenantId: string
  type: string
  status: AsyncJobStatus
  startedById: string | null
  totalItems: number | null
  /** Ítems terminados, bien o mal. Incluye los fallidos. */
  processedItems: number
  failedItems: number
  result: unknown
  startedAt: Date
  finishedAt: Date | null
}

const FINAL_STATUSES = new Set([
  AsyncJobStatus.Completed,
  AsyncJobStatus.CompletedWithErrors,
  AsyncJobStatus.Failed,
])

export function isFinished(job: Pick<AsyncJob, 'status'>): boolean {
  return FINAL_STATUSES.has(job.status)
}

/**
 * Estado final de un trabajo que terminó de recorrer sus ítems:
 * - no falló ningún ítem → `COMPLETED`;
 * - fallaron algunos → `COMPLETED_WITH_ERRORS`;
 * - fallaron todos → `FAILED`.
 *
 * Un trabajo sin ítems (no había nada que hacer) termina `COMPLETED`.
 */
export function finalStatus(
  job: Pick<AsyncJob, 'processedItems' | 'failedItems'>,
): AsyncJobStatus {
  if (job.failedItems === 0) return AsyncJobStatus.Completed
  if (job.failedItems < job.processedItems) {
    return AsyncJobStatus.CompletedWithErrors
  }
  return AsyncJobStatus.Failed
}

/** Avance de 0 a 100, o `null` si no se conoce el total. */
export function progressPercentage(
  job: Pick<AsyncJob, 'status' | 'processedItems' | 'totalItems'>,
): number | null {
  if (isFinished(job)) return 100
  if (!job.totalItems) return null
  return Math.min(100, Math.floor((job.processedItems / job.totalItems) * 100))
}
