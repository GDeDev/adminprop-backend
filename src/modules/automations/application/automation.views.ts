import { Injectable } from '@nestjs/common'

import { UserRef, UsersFacade } from '@/modules/auth/public'
import { IsoDate } from '@/shared/dates/calendar-date'
import { localMoment } from '@/shared/dates/zoned-time'
import { JobExecution, InternalAlert } from '../domain/automations.ports'
import {
  cronLabelOf,
  cronOf,
  JOB_CATALOG,
  JobExecutionStatus,
  JobScope,
  JobTrigger,
} from '../domain/job-catalog'
import { JobSchedulePolicy } from '../domain/job-schedule.policy'

export interface JobExecutionView {
  id: string
  job: string
  tenantId: string | null
  scheduledFor: IsoDate
  startedAt: Date
  finishedAt: Date | null
  status: JobExecutionStatus
  affected: number
  summary: string | null
  error: string | null
  triggeredBy: JobTrigger
  triggeredByUser: UserRef | null
}

export interface JobView {
  name: string
  title: string
  description: string
  cron: string
  cronLabel: string
  scope: JobScope
  lastExecution: JobExecutionView | null
  nextRunAt: string | null
}

export interface InternalAlertView {
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

/** Arma las vistas de la API: resuelve los nombres de usuario y el cron legible. */
@Injectable()
export class AutomationViews {
  constructor(private readonly users: UsersFacade) {}

  async executions(items: JobExecution[]): Promise<JobExecutionView[]> {
    const userIds = items.flatMap((e) =>
      e.triggeredByUserId ? [e.triggeredByUserId] : [],
    )
    const users =
      userIds.length > 0 ? await this.users.describe(userIds) : new Map()
    return items.map((e) => ({
      id: e.id,
      job: e.job,
      tenantId: e.tenantId,
      scheduledFor: e.scheduledFor,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
      status: e.status,
      affected: e.affected,
      summary: e.summary,
      error: e.error,
      triggeredBy: e.triggeredBy,
      triggeredByUser: e.triggeredByUserId
        ? (users.get(e.triggeredByUserId) ?? null)
        : null,
    }))
  }

  /** El catálogo con la última ejecución de cada job y la próxima prevista. */
  async jobs(
    last: Map<string, JobExecution>,
    enabled: boolean,
    now: Date = new Date(),
  ): Promise<JobView[]> {
    const executions = await this.executions([...last.values()])
    const byJob = new Map(executions.map((e) => [e.job, e]))
    const local = localMoment(now)
    return JOB_CATALOG.map((definition) => ({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      cron: cronOf(definition.times),
      cronLabel: cronLabelOf(definition.times),
      scope: definition.scope,
      lastExecution: byJob.get(definition.name) ?? null,
      nextRunAt: enabled
        ? JobSchedulePolicy.nextRunAt(definition, local, now).toISOString()
        : null,
    }))
  }

  alert(alert: InternalAlert): InternalAlertView {
    return { ...alert }
  }
}
