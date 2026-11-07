import { Injectable } from '@nestjs/common'

import { NotificationsService } from '@/platform/notifications/notifications.service'
import { errorMessage } from '@/shared/core/error-message'
import { createLogger } from '@/shared/logging/root-logger'
import {
  JobExecutionRepository,
  JobExecution,
} from '../domain/automations.ports'
import {
  findJobDefinition,
  JobExecutionStatus,
  JobScope,
  JobTrigger,
} from '../domain/job-catalog'
import { JOB_RETRY_LIMIT } from './automation-queues'
import { JobRegistry } from './job-registry'
import { JobMessage, JobOutcome } from './job.types'

/**
 * Ejecuta un job y deja el registro de negocio (`job_executions`, Fase 13,
 * 3.1). Si el job tira, la fila queda `FAILED` con el error y se vuelve a
 * tirar para que pg-boss reintente; al agotar los reintentos, el personal
 * recibe un aviso `JOB_FAILED` (los fallos nunca son silenciosos).
 */
@Injectable()
export class JobRunner {
  private readonly logger = createLogger('JobRunner')

  constructor(
    private readonly registry: JobRegistry,
    private readonly executions: JobExecutionRepository,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * @param tenantId el tenant del mensaje (ignorado en jobs globales).
   * @param retryCount 0 en el primer intento.
   */
  async execute(
    message: JobMessage,
    tenantId: string | undefined,
    retryCount = 0,
  ): Promise<JobExecution> {
    const definition = findJobDefinition(message.job)
    if (!definition) throw new Error(`Job desconocido: ${message.job}`)
    const scopedTenant =
      definition.scope === JobScope.TENANT ? (tenantId ?? null) : null
    if (definition.scope === JobScope.TENANT && !scopedTenant) {
      throw new Error(`El job ${message.job} necesita una inmobiliaria`)
    }

    const execution = await this.start(message, scopedTenant)
    try {
      const outcome = await this.registry.get(definition.name).run({
        tenantId: scopedTenant,
        today: message.scheduledFor,
        manual: message.manual,
        period: message.period,
      })
      const finished = await this.finish(execution.id, outcome)
      this.logger.info(
        {
          job: message.job,
          tenantId: scopedTenant,
          status: finished.status,
          affected: finished.affected,
        },
        `Job ${message.job}: ${outcome.summary}`,
      )
      return finished
    } catch (error) {
      await this.executions.finish(execution.id, {
        status: JobExecutionStatus.FAILED,
        affected: 0,
        summary: null,
        error: errorMessage(error),
        details: null,
      })
      this.logger.error(
        { err: error, job: message.job, tenantId: scopedTenant, retryCount },
        `Falló el job ${message.job}`,
      )
      if (scopedTenant && retryCount >= JOB_RETRY_LIMIT) {
        await this.alertFailure(scopedTenant, message, errorMessage(error))
      }
      throw error
    }
  }

  /** Reusa la fila creada al encolar; si no existe (mensaje viejo), crea una. */
  private async start(
    message: JobMessage,
    tenantId: string | null,
  ): Promise<JobExecution> {
    const existing = await this.executions.findById(message.executionId)
    if (existing) return this.executions.markRunning(existing.id)
    return this.executions.create({
      job: message.job,
      tenantId,
      scheduledFor: message.scheduledFor,
      triggeredBy: message.manual ? JobTrigger.MANUAL : JobTrigger.SCHEDULE,
      triggeredByUserId: null,
    })
  }

  private finish(id: string, outcome: JobOutcome): Promise<JobExecution> {
    return this.executions.finish(id, {
      status: outcome.status ?? JobExecutionStatus.SUCCEEDED,
      affected: outcome.affected,
      summary: outcome.summary,
      error: null,
      details: outcome.details ?? null,
    })
  }

  private async alertFailure(
    tenantId: string,
    message: JobMessage,
    error: string,
  ): Promise<void> {
    try {
      await this.notifications.notifyStaff({
        tenantId,
        type: 'JOB_FAILED',
        title: 'Falló un proceso automático',
        body: `${message.job} del ${message.scheduledFor} falló después de varios intentos: ${error}`,
        dedupeKey: `JOB_FAILED:${message.job}:${message.scheduledFor}`,
        link: '/configuracion/automatizaciones',
      })
    } catch (e) {
      this.logger.error({ err: e }, 'No se pudo avisar el fallo del job')
    }
  }
}
