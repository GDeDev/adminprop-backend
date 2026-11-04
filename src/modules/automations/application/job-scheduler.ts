import { Injectable } from '@nestjs/common'

import { TenantsFacade } from '@/modules/tenants/public'
import { QueuePort } from '@/platform/queue/queue.port'
import { RequestContext } from '@/shared/context/request-context'
import { errorMessage } from '@/shared/core/error-message'
import { IsoDate } from '@/shared/dates/calendar-date'
import { localMoment } from '@/shared/dates/zoned-time'
import { createLogger } from '@/shared/logging/root-logger'
import {
  JobExecution,
  JobExecutionRepository,
} from '../domain/automations.ports'
import {
  JOB_CATALOG,
  JobDefinition,
  JobExecutionStatus,
  JobScope,
  JobTrigger,
} from '../domain/job-catalog'
import { JobSchedulePolicy } from '../domain/job-schedule.policy'
import { queueOf } from './automation-queues'
import { JobMessage } from './job.types'

interface EnqueueOptions {
  triggeredBy: JobTrigger
  triggeredByUserId?: string | null
  scheduledFor: IsoDate
  period?: string | null
  /** Distingue dos corridas del mismo día en la `singletonKey`. */
  slot: string
}

/**
 * Encola los jobs (Fase 13, 1). Un solo `@Cron` por frecuencia dispara
 * `enqueueDue`; acá se decide qué corresponde. No pregunta "¿es la hora
 * exacta?" sino "¿cuántas corridas de hoy ya tenían que haber salido y cuántas
 * se encolaron?", así un servidor apagado a las 09:10 igual manda el aviso
 * cuando vuelve.
 */
@Injectable()
export class JobScheduler {
  private readonly logger = createLogger('JobScheduler')

  constructor(
    private readonly tenants: TenantsFacade,
    private readonly queue: QueuePort,
    private readonly executions: JobExecutionRepository,
  ) {}

  /** Encola lo que falte hoy. Devuelve cuántas corridas encoló. */
  async enqueueDue(now: Date = new Date()): Promise<number> {
    const local = localMoment(now)
    const counts = await this.executions.countScheduled(local.date)
    const tenants = await this.tenants.listActive()
    let enqueued = 0

    for (const definition of JOB_CATALOG) {
      const targets: (string | null)[] =
        definition.scope === JobScope.GLOBAL
          ? [null]
          : tenants.map((tenant) => tenant.id)
      for (const tenantId of targets) {
        const already = counts.get(`${definition.name}|${tenantId ?? ''}`) ?? 0
        const missing = JobSchedulePolicy.missingRuns(
          definition,
          local,
          already,
        )
        for (let i = 0; i < missing; i += 1) {
          try {
            const execution = await this.enqueue(definition, tenantId, {
              triggeredBy: JobTrigger.SCHEDULE,
              scheduledFor: local.date,
              slot: String(already + i),
            })
            if (execution) enqueued += 1
          } catch (error) {
            // Un tenant con problemas no puede frenar a los demás.
            this.logger.error(
              { err: error, job: definition.name, tenantId },
              'No se pudo encolar el job',
            )
          }
        }
      }
    }
    return enqueued
  }

  /**
   * Crea la fila de ejecución y encola el mensaje. `null` si la cola ya tenía
   * esa corrida (otra instancia llegó primero): la fila se descarta.
   */
  async enqueue(
    definition: JobDefinition,
    tenantId: string | null,
    options: EnqueueOptions,
  ): Promise<JobExecution | null> {
    const data = {
      job: definition.name,
      tenantId,
      scheduledFor: options.scheduledFor,
      triggeredBy: options.triggeredBy,
      triggeredByUserId: options.triggeredByUserId ?? null,
    }
    // Las programadas reservan su lugar en la base antes de publicar: si otra
    // réplica ya lo tomó, no hay nada que encolar.
    const execution =
      options.triggeredBy === JobTrigger.MANUAL
        ? await this.executions.create(data)
        : await this.executions.createScheduled(data, Number(options.slot))
    if (!execution) return null
    const message: JobMessage = {
      job: definition.name,
      executionId: execution.id,
      scheduledFor: options.scheduledFor,
      period: options.period ?? null,
      manual: options.triggeredBy === JobTrigger.MANUAL,
    }
    const singletonKey =
      options.triggeredBy === JobTrigger.MANUAL
        ? `${definition.name}:${tenantId ?? 'global'}:manual:${execution.id}`
        : `${definition.name}:${tenantId ?? 'global'}:${options.scheduledFor}:${options.slot}`

    try {
      const publish = () =>
        this.queue.publish(queueOf(definition.name), message, { singletonKey })
      await (tenantId
        ? RequestContext.runInTenant(tenantId, publish)
        : publish())
      return execution
    } catch (error) {
      if (error instanceof Error && error.name === 'DuplicateJobError') {
        await this.executions.delete(execution.id)
        return null
      }
      await this.executions.finish(execution.id, {
        status: JobExecutionStatus.FAILED,
        affected: 0,
        summary: null,
        error: `No se pudo encolar: ${errorMessage(error)}`,
        details: null,
      })
      throw error
    }
  }
}
