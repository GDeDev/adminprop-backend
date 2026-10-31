import { ConfigService } from '@nestjs/config'
import {
  CommandHandler,
  ICommandHandler,
  IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs'

import { IndexType, IndicesFacade } from '@/modules/indices/public'
import { IndexSourcePort } from '@/platform/index-source/index-source.port'
import { Configuration } from '@/shared/config/configuration'
import { RequestContext } from '@/shared/context/request-context'
import { isValidPeriod } from '@/shared/dates/calendar-date'
import { localMoment } from '@/shared/dates/zoned-time'
import { PaginatedResult, paginateWith } from '@/shared/pagination'
import {
  AlertNotFoundException,
  InvalidJobPeriodException,
  JobAlreadyRunningException,
  JobNotFoundException,
} from '../domain/automations.exceptions'
import {
  AlertRepository,
  JobExecutionRepository,
} from '../domain/automations.ports'
import {
  findJobDefinition,
  IndexFetchStatus,
  JobExecutionStatus,
  JobName,
  JobScope,
  JobTrigger,
} from '../domain/job-catalog'
import {
  GetIndexStatusQuery,
  ListAlertsQuery,
  ListExecutionsQuery,
  ListJobsQuery,
  MarkAlertReadCommand,
  MarkAllAlertsReadCommand,
  RunJobCommand,
} from './automation.commands'
import {
  AutomationViews,
  InternalAlertView,
  JobExecutionView,
  JobView,
} from './automation.views'
import { JobScheduler } from './job-scheduler'

/** Los tipos que la campana del backoffice muestra (Fase 13, 8). */
export const ALERT_TYPES = [
  'RENT_UPDATE_PENDING',
  'INDEX_FETCH_FAILED',
  'INSTALLMENT_BASE_OUTDATED',
  'STATEMENT_PENDING',
  'DOCUMENT_FAILED',
  'JOB_FAILED',
]

/** Cuánto atrás llega la lista de avisos (Fase 13, 5). */
const ALERT_WINDOW_DAYS = 30
/** Una corrida `RUNNING` más vieja que esto se da por perdida y no bloquea otra. */
const RUNNING_STALE_MINUTES = 15

function requireTenant(): string {
  const tenantId = RequestContext.tenantId
  if (!tenantId) throw new Error('Operación de automatizaciones sin tenant')
  return tenantId
}

@QueryHandler(ListJobsQuery)
export class ListJobsHandler implements IQueryHandler<
  ListJobsQuery,
  JobView[]
> {
  constructor(
    private readonly executions: JobExecutionRepository,
    private readonly views: AutomationViews,
    private readonly config: ConfigService<Configuration, true>,
  ) {}

  async execute(): Promise<JobView[]> {
    const last = await this.executions.lastByJob(requireTenant())
    return this.views.jobs(
      last,
      this.config.get('automations', { infer: true }).enabled,
    )
  }
}

@QueryHandler(ListExecutionsQuery)
export class ListExecutionsHandler implements IQueryHandler<
  ListExecutionsQuery,
  PaginatedResult<JobExecutionView>
> {
  constructor(
    private readonly executions: JobExecutionRepository,
    private readonly views: AutomationViews,
  ) {}

  execute(
    query: ListExecutionsQuery,
  ): Promise<PaginatedResult<JobExecutionView>> {
    const tenantId = requireTenant()
    return paginateWith(query.page, async (page) => {
      const [items, total] = await this.executions.list(
        tenantId,
        {
          job: query.filter.job,
          status: query.filter.status as JobExecutionStatus | undefined,
          from: query.filter.from,
          to: query.filter.to,
        },
        page,
      )
      return [await this.views.executions(items), total]
    })
  }
}

/**
 * Encola una corrida manual para la inmobiliaria del usuario (o global, en
 * índices). Responde enseguida con el id de la ejecución, que ya existe
 * `RUNNING`; el resultado se ve en el historial. No se puede pisar una
 * corrida en curso del mismo job.
 */
@CommandHandler(RunJobCommand)
export class RunJobHandler implements ICommandHandler<
  RunJobCommand,
  { executionId: string }
> {
  constructor(
    private readonly scheduler: JobScheduler,
    private readonly executions: JobExecutionRepository,
  ) {}

  async execute(command: RunJobCommand): Promise<{ executionId: string }> {
    const definition = findJobDefinition(command.job)
    if (!definition) throw new JobNotFoundException(command.job)
    if (command.period !== undefined && !isValidPeriod(command.period.trim())) {
      throw new InvalidJobPeriodException()
    }

    const tenantId =
      definition.scope === JobScope.GLOBAL ? null : requireTenant()
    const since = new Date(Date.now() - RUNNING_STALE_MINUTES * 60_000)
    if (
      await this.executions.findRecentRunning(definition.name, tenantId, since)
    ) {
      throw new JobAlreadyRunningException(definition.name)
    }

    const execution = await this.scheduler.enqueue(definition, tenantId, {
      triggeredBy: JobTrigger.MANUAL,
      triggeredByUserId: RequestContext.userId ?? null,
      scheduledFor: localMoment().date,
      period: command.period?.trim() ?? null,
      slot: 'manual',
    })
    // `null` sólo pasa con una clave repetida, que en manual es imposible.
    return { executionId: execution!.id }
  }
}

@QueryHandler(ListAlertsQuery)
export class ListAlertsHandler implements IQueryHandler<
  ListAlertsQuery,
  PaginatedResult<InternalAlertView>
> {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly views: AutomationViews,
  ) {}

  execute(query: ListAlertsQuery): Promise<PaginatedResult<InternalAlertView>> {
    const since = new Date(Date.now() - ALERT_WINDOW_DAYS * 86_400_000)
    return paginateWith(query.page, async (page) => {
      const [items, total] = await this.alerts.list(
        { unreadOnly: query.unreadOnly, since, types: ALERT_TYPES },
        page,
      )
      return [items.map((a) => this.views.alert(a)), total]
    })
  }
}

@CommandHandler(MarkAlertReadCommand)
export class MarkAlertReadHandler implements ICommandHandler<
  MarkAlertReadCommand,
  InternalAlertView
> {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly views: AutomationViews,
  ) {}

  async execute(command: MarkAlertReadCommand): Promise<InternalAlertView> {
    const alert = await this.alerts.markRead(command.id, new Date())
    if (!alert) throw new AlertNotFoundException(command.id)
    return this.views.alert(alert)
  }
}

@CommandHandler(MarkAllAlertsReadCommand)
export class MarkAllAlertsReadHandler implements ICommandHandler<
  MarkAllAlertsReadCommand,
  { updated: number }
> {
  constructor(private readonly alerts: AlertRepository) {}

  async execute(): Promise<{ updated: number }> {
    return { updated: await this.alerts.markAllRead(ALERT_TYPES, new Date()) }
  }
}

export interface IndexStatusView {
  indexType: IndexType
  latestPeriod: string | null
  latestValue: string | null
  source: string | null
  lastAttemptAt: Date | null
  lastAttemptStatus: IndexFetchStatus | null
  lastAttemptError: string | null
  provider: string
}

/**
 * Por tipo de índice: el último mes cargado y cómo le fue al último intento de
 * traerlo. El intento sale de la última corrida terminada de `indices.fetch`
 * (su `details` trae el resultado por tipo).
 */
@QueryHandler(GetIndexStatusQuery)
export class GetIndexStatusHandler implements IQueryHandler<
  GetIndexStatusQuery,
  IndexStatusView[]
> {
  constructor(
    private readonly indices: IndicesFacade,
    private readonly executions: JobExecutionRepository,
    private readonly source: IndexSourcePort,
  ) {}

  async execute(): Promise<IndexStatusView[]> {
    const recent = await this.executions.lastGlobal(JobName.INDICES_FETCH, 5)
    const attempt = recent.find((e) => e.status !== JobExecutionStatus.RUNNING)

    return Promise.all(
      [IndexType.ICL, IndexType.IPC].map(async (indexType) => {
        const latest = await this.indices.latest(indexType)
        const detail = attempt?.details?.[indexType] as
          { status?: IndexFetchStatus; error?: string | null } | undefined
        return {
          indexType,
          latestPeriod: latest?.period ?? null,
          latestValue: latest?.value ?? null,
          source: latest?.source ?? null,
          lastAttemptAt: attempt
            ? (attempt.finishedAt ?? attempt.startedAt)
            : null,
          lastAttemptStatus: attempt
            ? (detail?.status ??
              (attempt.status as unknown as IndexFetchStatus))
            : null,
          lastAttemptError: attempt ? (detail?.error ?? attempt.error) : null,
          provider: this.source.provider,
        }
      }),
    )
  }
}
