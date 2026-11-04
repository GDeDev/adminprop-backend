import { QueueDefinition } from '@/platform/queue/queue.port'
import { JobName } from '../domain/job-catalog'

/** Reintentos de un job que tira (Fase 13, 1): 3 intentos más, cada 60 s. */
export const JOB_RETRY_LIMIT = 3

/**
 * Una cola de pg-boss por job. El nombre no admite puntos, así que
 * `billing.arrears-notice` es la cola `automation-billing-arrears-notice`.
 */
export function queueOf(job: JobName | string): QueueDefinition {
  return {
    name: `automation-${job.replace(/\./g, '-')}`,
    retryLimit: JOB_RETRY_LIMIT,
    retryDelaySeconds: 60,
    retryBackoff: false,
    // Todos los mensajes de estas colas llevan singletonKey (job-scheduler).
    dedupeBySingletonKey: true,
  }
}
