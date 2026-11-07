import { Injectable } from '@nestjs/common'

import { UsersFacade } from '@/modules/auth/public'
import { QueuePort } from '@/platform/queue/queue.port'
import {
  NotificationsPipeline,
  SendOutcome,
} from '@/platform/notifications/notifications-pipeline'
import { NotificationRequest } from '@/platform/notifications/notifications.port'
import { createLogger } from '@/shared/logging/root-logger'
import { errorMessage } from '@/shared/core/error-message'
import { decideDelivery } from '../domain/delivery-policy'
import { ChannelName, findCatalogEntry } from '../domain/notification-catalog'
import {
  NewNotification,
  NotificationConfigRepository,
  NotificationLogRepository,
  NotificationRow,
  RecipientKindName,
  StatusName,
} from '../domain/notification.ports'
import { renderEmail } from '../domain/notification-templates'
import {
  NOTIFICATIONS_DELIVER_QUEUE,
  NotificationDeliverPayload,
} from './notification-queues'
import {
  buildTemplateVariables,
  recipientNameOf,
} from './notification-variables'
import { TemplateService } from './template.service'

/**
 * El camino de un aviso (REDISENO_FASE_14, 2): dedupe, preferencias, plantilla
 * y cola de entrega. Reemplaza al envío directo de la Fase 13 sin cambiar lo
 * que los jobs ven.
 *
 * Una fila de `notification_log` por aviso y destinatario; el personal recibe
 * un mail por persona (cada uno con su `dedupeKey`) y un único aviso interno
 * compartido por la campana.
 */
@Injectable()
export class NotificationPipeline extends NotificationsPipeline {
  private readonly logger = createLogger('NotificationPipeline')

  constructor(
    private readonly log: NotificationLogRepository,
    private readonly config: NotificationConfigRepository,
    private readonly templates: TemplateService,
    private readonly users: UsersFacade,
    private readonly queue: QueuePort,
  ) {
    super()
  }

  async process(request: NotificationRequest): Promise<SendOutcome> {
    const channels = request.channels as unknown as ChannelName[]
    const isStaffBroadcast =
      (request.recipient.kind as string) === 'TENANT_STAFF' &&
      !request.recipient.id &&
      channels.includes('EMAIL')
    if (!isStaffBroadcast) return this.processOne(request)

    const outcomes: SendOutcome[] = []
    if (channels.includes('IN_APP')) {
      outcomes.push(
        await this.processOne({
          ...request,
          channels: ['IN_APP'] as unknown as NotificationRequest['channels'],
        }),
      )
    }
    const contacts = await this.users.listStaffContacts()
    if (contacts.length === 0) {
      // Nadie a quien avisar: queda constancia en el historial.
      outcomes.push(
        await this.processOne({
          ...request,
          channels: ['EMAIL'] as unknown as NotificationRequest['channels'],
        }),
      )
    }
    for (const contact of contacts) {
      outcomes.push(
        await this.processOne({
          ...request,
          recipient: {
            kind: request.recipient.kind,
            id: contact.userId,
            email: contact.email,
          },
          dedupeKey: `${request.dedupeKey}:u:${contact.userId}`,
          channels: ['EMAIL'] as unknown as NotificationRequest['channels'],
          data: { ...request.data, recipientName: contact.fullName },
        }),
      )
    }
    if (outcomes.includes('SENT')) return 'SENT'
    return outcomes.includes('FAILED') ? 'FAILED' : 'SKIPPED'
  }

  private async processOne(request: NotificationRequest): Promise<SendOutcome> {
    try {
      return await this.run(request)
    } catch (error) {
      this.logger.error(
        { err: error, dedupeKey: request.dedupeKey, type: request.type },
        `No se pudo procesar el aviso: ${errorMessage(error)}`,
      )
      return 'FAILED'
    }
  }

  private async run(request: NotificationRequest): Promise<SendOutcome> {
    const existing = await this.log.findByDedupeKey(request.dedupeKey)
    // Un aviso ya encolado o enviado nunca se repite. Uno fallido, o descartado
    // por una preferencia o por falta de contacto, se vuelve a evaluar: el
    // email pudo cargarse o el tipo habilitarse desde la última corrida.
    if (
      existing &&
      existing.status !== 'FAILED' &&
      existing.status !== 'SKIPPED'
    ) {
      return 'SKIPPED'
    }

    const requested = request.channels as unknown as ChannelName[]
    const entry = findCatalogEntry(request.type)
    const recipientKind = request.recipient.kind as unknown as RecipientKindName
    const baseRow = {
      type: request.type,
      recipientKind,
      recipientId: request.recipient.id ?? null,
      recipientEmail: request.recipient.email ?? null,
      entityType: request.entity?.type ?? null,
      entityId: request.entity?.id ?? null,
      dedupeKey: request.dedupeKey,
    }
    const payload = {
      ...request.data,
      channels: requested,
      phone: request.recipient.phone ?? null,
    }

    const decision = entry
      ? decideDelivery({
          entry,
          requestedChannels: requested,
          setting:
            (await this.config.listSettings()).find(
              (row) => row.type === request.type,
            ) ?? null,
          userPreference:
            recipientKind === 'TENANT_STAFF' && request.recipient.id
              ? await this.config.findUserPreference(
                  request.recipient.id,
                  request.type,
                )
              : null,
          email: request.recipient.email,
          phone: request.recipient.phone,
        })
      : requested.length === 0
        ? ({ send: false, reason: 'CHANNEL_DISABLED' } as const)
        : ({ send: true, channels: requested } as const)

    if (!decision.send) {
      return this.recordOutcome(existing, {
        ...baseRow,
        channel: requested[0] ?? 'EMAIL',
        status: 'SKIPPED',
        skipReason: decision.reason,
        payload,
      })
    }

    const channel = decision.channels[0]
    if (channel !== 'EMAIL') {
      // Aviso interno o link de WhatsApp: no hay nada que entregar, el
      // backoffice lo muestra o arma el link al momento.
      await this.recordOutcome(existing, {
        ...baseRow,
        channel,
        status: 'SENT',
        sentAt: new Date(),
        payload: { ...payload, channels: decision.channels },
      })
      return 'SENT'
    }

    const template = await this.templates.resolveForType(request.type)
    if (!template) {
      return this.recordOutcome(existing, {
        ...baseRow,
        channel,
        status: 'FAILED',
        error: `El tipo ${request.type} no tiene plantilla de email`,
        payload,
      })
    }
    const agency = await this.templates.agency(request.tenantId)
    const rendered = renderEmail(
      template.subject,
      template.bodyText,
      buildTemplateVariables(
        request.data,
        recipientNameOf(recipientKind, request.data),
        agency,
      ),
    )
    const row = await this.upsert(existing, {
      ...baseRow,
      channel,
      status: 'QUEUED',
      templateKey: template.key,
      subject: rendered.subject.slice(0, 200),
      payload: {
        ...payload,
        channels: decision.channels,
        bodyText: rendered.text,
      },
    })
    if (!row) return 'SKIPPED'

    try {
      await this.queue.publish<NotificationDeliverPayload>(
        NOTIFICATIONS_DELIVER_QUEUE,
        { notificationId: row.id },
      )
    } catch (error) {
      await this.log.update(row.id, {
        status: 'FAILED',
        error: `No se pudo encolar la entrega: ${errorMessage(error)}`,
      })
      return 'FAILED'
    }
    return 'SENT'
  }

  /** Crea la fila o pisa la que había (FAILED o SKIPPED). Devuelve null si la ganó otro proceso. */
  private async upsert(
    existing: NotificationRow | null,
    data: NewNotification & { error?: string },
  ): Promise<NotificationRow | null> {
    const { error, ...fields } = data
    if (existing) {
      return this.log.update(existing.id, {
        templateKey: fields.templateKey ?? null,
        channel: fields.channel,
        status: fields.status,
        skipReason: fields.skipReason ?? null,
        recipientEmail: fields.recipientEmail ?? null,
        subject: fields.subject ?? null,
        attempts: 0,
        nextAttemptAt: null,
        error: error ?? null,
        sentAt: fields.sentAt ?? null,
        payload: fields.payload,
      })
    }
    const row = await this.log.create(fields)
    return row && error ? this.log.update(row.id, { error }) : row
  }

  private async recordOutcome(
    existing: NotificationRow | null,
    data: NewNotification & { error?: string },
  ): Promise<SendOutcome> {
    const row = await this.upsert(existing, data)
    // Otro proceso la creó entre el chequeo y el alta.
    if (!row) return 'SKIPPED'
    return OUTCOME[data.status]
  }
}

const OUTCOME: Record<StatusName, SendOutcome> = {
  QUEUED: 'SENT',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
}
