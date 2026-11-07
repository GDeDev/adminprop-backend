import { IsoDate } from '@/shared/dates/calendar-date'
import { JobExecutionStatus, JobTrigger } from './job-catalog'

/** Una corrida de un job (`job_executions`). */
export interface JobExecution {
  id: string
  job: string
  /** Null en los jobs globales. */
  tenantId: string | null
  scheduledFor: IsoDate
  startedAt: Date
  finishedAt: Date | null
  status: JobExecutionStatus
  affected: number
  summary: string | null
  error: string | null
  details: Record<string, unknown> | null
  triggeredBy: JobTrigger
  triggeredByUserId: string | null
}

export interface NewJobExecution {
  job: string
  tenantId: string | null
  scheduledFor: IsoDate
  triggeredBy: JobTrigger
  triggeredByUserId: string | null
}

export interface JobExecutionResult {
  status: JobExecutionStatus
  affected: number
  summary: string | null
  error: string | null
  details: Record<string, unknown> | null
}

export interface ExecutionFilter {
  job?: string
  status?: JobExecutionStatus
  /** Rango de `scheduledFor`, inclusive. */
  from?: IsoDate
  to?: IsoDate
}

export interface PageArgs {
  skip: number
  take: number
}

/**
 * Puerto del repositorio de ejecuciones. `job_executions` no tiene filtro de
 * tenant (los jobs globales no tienen inmobiliaria): lo que se lee desde la
 * API es lo del tenant del contexto **o** lo global.
 */
export abstract class JobExecutionRepository {
  abstract create(data: NewJobExecution): Promise<JobExecution>

  /**
   * Reserva la corrida programada `slot` del día. `null` si otra instancia ya
   * la reservó (el índice único lo decide en la base, sin carrera).
   */
  abstract createScheduled(
    data: NewJobExecution,
    slot: number,
  ): Promise<JobExecution | null>

  abstract findById(id: string): Promise<JobExecution | null>

  /** Vuelve a `RUNNING` (reintento de la cola) sin tocar el resto. */
  abstract markRunning(id: string): Promise<JobExecution>

  abstract finish(id: string, result: JobExecutionResult): Promise<JobExecution>

  abstract delete(id: string): Promise<void>

  /** Del tenant (o global) con filtros, más nuevas primero. */
  abstract list(
    tenantId: string,
    filter: ExecutionFilter,
    page: PageArgs,
  ): Promise<[JobExecution[], number]>

  /** La última de cada job que ve el tenant, por nombre de job. */
  abstract lastByJob(tenantId: string): Promise<Map<string, JobExecution>>

  /** Las últimas del job global, más nuevas primero. */
  abstract lastGlobal(job: string, take: number): Promise<JobExecution[]>

  /**
   * Cuántas corridas programadas (no manuales) hay de ese día por job y
   * tenant. Clave: `<job>|<tenantId o "">`.
   */
  abstract countScheduled(date: IsoDate): Promise<Map<string, number>>

  /** Una corrida `RUNNING` reciente del mismo job para ese tenant (o global). */
  abstract findRecentRunning(
    job: string,
    tenantId: string | null,
    since: Date,
  ): Promise<JobExecution | null>
}

/** Un aviso interno tal como se guardó en `notification_log`. */
export interface InternalAlert {
  id: string
  type: string
  title: string
  body: string
  entityType: string | null
  entityId: string | null
  link: string | null
  createdAt: Date
  readAt: Date | null
}

/** Avisos internos (`IN_APP` al personal) del tenant del contexto. */
export abstract class AlertRepository {
  abstract list(
    filter: { unreadOnly: boolean; since: Date; types: string[] },
    page: PageArgs,
  ): Promise<[InternalAlert[], number]>

  /** Marca leído (idempotente); null si no existe en este tenant. */
  abstract markRead(id: string, at: Date): Promise<InternalAlert | null>

  /** Marca todos los no leídos de esos tipos; devuelve cuántos. */
  abstract markAllRead(types: string[], at: Date): Promise<number>
}
