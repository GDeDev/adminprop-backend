import { IsoDate } from '@/shared/dates/calendar-date'
import { JobExecutionStatus, JobName } from '../domain/job-catalog'

/** Lo que recibe un job al correr. */
export interface JobContext {
  /** La inmobiliaria; null en los jobs globales. */
  tenantId: string | null
  /** El día (hora local) al que corresponde la corrida. */
  today: IsoDate
  /**
   * Corrida manual (`POST /automations/jobs/:job/run`): se saltea la
   * condición de "hoy es el día N", pero no la idempotencia.
   */
  manual: boolean
  /** Mes pedido a mano (`AAAA-MM`), si lo hubo. */
  period: string | null
}

/** Lo que devuelve un job: se guarda tal cual en `job_executions`. */
export interface JobOutcome {
  /** Default `SUCCEEDED`. */
  status?:
    | JobExecutionStatus.SUCCEEDED
    | JobExecutionStatus.PARTIAL
    | JobExecutionStatus.FAILED
    | JobExecutionStatus.SKIPPED
  /** Cuántas cosas tocó: cuotas creadas, avisos enviados, contratos cerrados. */
  affected: number
  summary: string
  details?: Record<string, unknown>
}

/**
 * Un job de negocio. Idempotente a nivel de negocio (Fase 13, 1): correrlo dos
 * veces el mismo día no duplica nada. Corre dentro del tenant de la cola, así
 * que las facades filtran igual que en un request.
 */
export interface AutomationJob {
  readonly name: JobName
  run(context: JobContext): Promise<JobOutcome>
}

/** Lo que viaja por la cola de cada job. */
export interface JobMessage {
  job: string
  /** La fila de `job_executions` que se actualiza. */
  executionId: string
  scheduledFor: IsoDate
  period: string | null
  manual: boolean
}
