import { Injectable } from '@nestjs/common'

import { RequestContext } from '@/shared/context/request-context'
import {
  AsyncJob,
  AsyncJobStatus,
  finalStatus,
  isFinished,
} from '../domain/async-job.entity'
import { AsyncJobNotFoundException } from '../domain/async-job.exceptions'
import { AsyncJobRepository } from '../domain/async-job.repository'

/**
 * Lo que otros módulos usan para reportar un trabajo pesado (spec Fase 1,
 * 9.1). El flujo completo:
 *
 * ```ts
 * // En el handler del request: crear, encolar, responder 202.
 * const jobId = await this.jobs.start('regenerate-pdfs', { totalItems: ids.length })
 * await this.queue.publish(QUEUE, { jobId, ids })
 * return { jobId }
 *
 * // En el consumidor de la cola (ya dentro del tenant):
 * await this.jobs.markProcessing(jobId)
 * for (const id of ids) {
 *   try { await work(id); await this.jobs.recordItem(jobId, 'succeeded') }
 *   catch { await this.jobs.recordItem(jobId, 'failed') }
 * }
 * await this.jobs.complete(jobId)
 * ```
 *
 * Todo corre dentro del tenant del contexto.
 */
@Injectable()
export class AsyncJobsFacade {
  constructor(private readonly jobs: AsyncJobRepository) {}

  /** Crea el trabajo en `PENDING` y devuelve su id, para el `202`. */
  async start(
    type: string,
    options: { totalItems?: number } = {},
  ): Promise<string> {
    const job = await this.jobs.create({
      type,
      startedById: RequestContext.userId ?? null,
      totalItems: options.totalItems ?? null,
    })
    return job.id
  }

  markProcessing(jobId: string): Promise<void> {
    return this.jobs.markProcessing(jobId)
  }

  /** Reporta un ítem terminado. Atómico: varios workers pueden reportar a la vez. */
  async recordItem(
    jobId: string,
    outcome: 'succeeded' | 'failed',
  ): Promise<void> {
    await this.jobs.recordItems(jobId, {
      processed: 1,
      failed: outcome === 'failed' ? 1 : 0,
    })
  }

  /**
   * Cierra el trabajo con el estado que corresponde a sus contadores
   * (`COMPLETED`, `COMPLETED_WITH_ERRORS` o `FAILED`). Idempotente: si ya
   * estaba cerrado —un reintento de la cola—, no lo toca.
   */
  async complete(jobId: string, result?: unknown): Promise<void> {
    const job = await this.get(jobId)
    if (isFinished(job)) return
    await this.jobs.finish(jobId, finalStatus(job), result)
  }

  /** Cierra el trabajo como `FAILED` por un error que impidió seguir. */
  async fail(jobId: string, reason: string): Promise<void> {
    const job = await this.get(jobId)
    if (isFinished(job)) return
    await this.jobs.finish(jobId, AsyncJobStatus.Failed, { reason })
  }

  private async get(jobId: string): Promise<AsyncJob> {
    const job = await this.jobs.findById(jobId)
    if (!job) throw new AsyncJobNotFoundException(jobId)
    return job
  }
}
