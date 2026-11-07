import { Injectable } from '@nestjs/common'
import {
  CommandHandler,
  ICommandHandler,
  IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs'

import { AuditFacade } from '@/modules/audit/public'
import { AsyncJobsFacade } from '@/modules/jobs/public'
import { QueuePort } from '@/platform/queue/queue.port'
import { RequestContext } from '@/shared/context/request-context'
import { PaginatedResult, paginateWith } from '@/shared/pagination'
import {
  NotificationNotFoundException,
  NotificationNotResendableException,
} from '../domain/notification.exceptions'
import {
  EmailEventRepository,
  NotificationFilter,
  NotificationLogRepository,
} from '../domain/notification.ports'
import {
  GetNotificationQuery,
  ListNotificationsQuery,
  NotificationFilterInput,
  ResendFailedCommand,
  ResendNotificationCommand,
  SimulateEmailEventCommand,
} from './notification.commands'
import {
  canResend,
  NotificationDetailView,
  NotificationLogItemView,
  toDetail,
  toLogItem,
} from './notification.views'
import { NotificationDeliveryService } from './notification-delivery.service'
import { ResendEventService } from './resend-event.service'
import {
  NOTIFICATIONS_DELIVER_QUEUE,
  NOTIFICATIONS_RESEND_FAILED_QUEUE,
  NotificationDeliverPayload,
  NotificationsResendFailedPayload,
  RESEND_FAILED_JOB_TYPE,
} from './notification-queues'

function toFilter(input: NotificationFilterInput): NotificationFilter {
  return {
    type: input.type,
    status: input.status,
    channel: input.channel,
    recipientKind: input.recipientKind,
    entityId: input.entityId,
    from: input.from ? new Date(input.from) : undefined,
    to: input.to ? new Date(input.to) : undefined,
  }
}

@QueryHandler(ListNotificationsQuery)
export class ListNotificationsHandler implements IQueryHandler<
  ListNotificationsQuery,
  PaginatedResult<NotificationLogItemView>
> {
  constructor(
    private readonly log: NotificationLogRepository,
    private readonly events: EmailEventRepository,
  ) {}

  execute(
    query: ListNotificationsQuery,
  ): Promise<PaginatedResult<NotificationLogItemView>> {
    return paginateWith(query.page, async (page) => {
      const [rows, total] = await this.log.list(toFilter(query.filter), page)
      const events = await this.events.listByNotificationIds(
        rows.map((row) => row.id),
      )
      return [
        rows.map((row) =>
          toLogItem(
            row,
            events.filter((event) => event.notificationId === row.id),
          ),
        ),
        total,
      ]
    })
  }
}

@QueryHandler(GetNotificationQuery)
export class GetNotificationHandler implements IQueryHandler<
  GetNotificationQuery,
  NotificationDetailView
> {
  constructor(
    private readonly log: NotificationLogRepository,
    private readonly events: EmailEventRepository,
  ) {}

  async execute(query: GetNotificationQuery): Promise<NotificationDetailView> {
    // El filtro de tenant hace que una fila de otra inmobiliaria no aparezca.
    const row = await this.log.findById(query.id)
    if (!row) throw new NotificationNotFoundException(query.id)
    return toDetail(row, await this.events.listByNotificationIds([row.id]))
  }
}

/** Vuelve a poner una fila fallida en la cola, con los intentos en cero. */
async function requeue(
  log: NotificationLogRepository,
  id: string,
): Promise<void> {
  await log.update(id, {
    status: 'QUEUED',
    attempts: 0,
    error: null,
    nextAttemptAt: null,
  })
}

@CommandHandler(ResendNotificationCommand)
export class ResendNotificationHandler implements ICommandHandler<
  ResendNotificationCommand,
  NotificationLogItemView
> {
  constructor(
    private readonly log: NotificationLogRepository,
    private readonly events: EmailEventRepository,
    private readonly queue: QueuePort,
    private readonly audit: AuditFacade,
  ) {}

  async execute(
    command: ResendNotificationCommand,
  ): Promise<NotificationLogItemView> {
    const row = await this.log.findById(command.id)
    if (!row) throw new NotificationNotFoundException(command.id)
    if (!canResend(row)) throw new NotificationNotResendableException(row.id)

    await requeue(this.log, row.id)
    await this.audit.record({
      action: 'NOTIFICATION_SENT',
      entity: 'Notification',
      entityId: row.id,
      summary: `Se pidió reenviar el aviso ${row.type} (${row.recipientKind})`,
    })
    await this.queue.publish<NotificationDeliverPayload>(
      NOTIFICATIONS_DELIVER_QUEUE,
      { notificationId: row.id },
    )
    const updated = (await this.log.findById(row.id)) ?? row
    return toLogItem(updated, await this.events.listByNotificationIds([row.id]))
  }
}

@CommandHandler(ResendFailedCommand)
export class ResendFailedHandler implements ICommandHandler<
  ResendFailedCommand,
  { jobId: string }
> {
  constructor(
    private readonly log: NotificationLogRepository,
    private readonly jobs: AsyncJobsFacade,
    private readonly queue: QueuePort,
  ) {}

  async execute(command: ResendFailedCommand): Promise<{ jobId: string }> {
    const filter = toFilter(command.filter)
    const ids = await this.log.failedIds(filter)
    const jobId = await this.jobs.start(RESEND_FAILED_JOB_TYPE, {
      totalItems: ids.length,
    })
    await this.queue.publish<NotificationsResendFailedPayload>(
      NOTIFICATIONS_RESEND_FAILED_QUEUE,
      { jobId, ...command.filter },
    )
    return { jobId }
  }
}

@CommandHandler(SimulateEmailEventCommand)
export class SimulateEmailEventHandler implements ICommandHandler<
  SimulateEmailEventCommand,
  { recorded: boolean }
> {
  constructor(
    private readonly log: NotificationLogRepository,
    private readonly resendEvents: ResendEventService,
  ) {}

  async execute(
    command: SimulateEmailEventCommand,
  ): Promise<{ recorded: boolean }> {
    const row = await this.log.findById(command.notificationId)
    if (!row) throw new NotificationNotFoundException(command.notificationId)
    if (!row.providerMessageId) {
      throw new NotificationNotResendableException(row.id)
    }
    const recorded = await this.resendEvents.record({
      providerMessageId: row.providerMessageId,
      type: command.type,
      occurredAt: new Date(),
      recipientEmail: row.recipientEmail,
      payloadRaw: { simulated: true, type: command.type },
    })
    return { recorded }
  }
}

/**
 * Cuerpo del trabajo "reintentar todas las fallidas": cada fila se vuelve a
 * encolar y se intenta en el momento, así el progreso del AsyncJob refleja
 * cuántas salieron de verdad.
 */
@Injectable()
export class ResendFailedRunner {
  constructor(
    private readonly log: NotificationLogRepository,
    private readonly delivery: NotificationDeliveryService,
    private readonly jobs: AsyncJobsFacade,
  ) {}

  async run(payload: NotificationsResendFailedPayload): Promise<void> {
    const { jobId } = payload
    try {
      await this.jobs.markProcessing(jobId)
      const ids = await this.log.failedIds({
        type: payload.type,
        from: payload.from ? new Date(payload.from) : undefined,
        to: payload.to ? new Date(payload.to) : undefined,
      })
      for (const id of ids) {
        try {
          await requeue(this.log, id)
          const status = await this.delivery.deliver(id, { manual: true })
          await this.jobs.recordItem(
            jobId,
            status === 'SENT' ? 'succeeded' : 'failed',
          )
        } catch {
          await this.jobs.recordItem(jobId, 'failed')
        }
      }
      await this.jobs.complete(jobId, {
        userId: RequestContext.userId ?? null,
      })
    } catch (error) {
      await this.jobs.fail(
        jobId,
        error instanceof Error ? error.message : 'Error inesperado',
      )
    }
  }
}
