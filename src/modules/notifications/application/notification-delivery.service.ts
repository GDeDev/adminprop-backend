import { Injectable } from '@nestjs/common'

import { AuditFacade, eventChanges } from '@/modules/audit/public'
import { DocumentKind, DocumentsFacade } from '@/modules/documents/public'
import { TenantsFacade } from '@/modules/tenants/public'
import {
  EmailAttachment,
  EmailDeliveryError,
  EmailPort,
} from '@/platform/email/email.port'
import { NotificationRequest } from '@/platform/notifications/notifications.port'
import { QueuePort } from '@/platform/queue/queue.port'
import { errorMessage } from '@/shared/core/error-message'
import { createLogger } from '@/shared/logging/root-logger'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_WAITS,
  retryDelaySeconds,
} from '../domain/delivery-policy'
import { findCatalogEntry } from '../domain/notification-catalog'
import {
  NotificationLogRepository,
  NotificationRow,
  StatusName,
} from '../domain/notification.ports'
import { NotificationPipeline } from './notification.pipeline'
import {
  NOTIFICATIONS_DELIVER_QUEUE,
  NotificationDeliverPayload,
} from './notification-queues'
import { TemplateService } from './template.service'

/** Qué PDF acompaña a cada tipo (A-59). */
const ATTACHMENT_KIND: Record<string, DocumentKind> = {
  SETTLEMENT_CONFIRMED: DocumentKind.SETTLEMENT,
  OWNER_STATEMENT_CLOSED: DocumentKind.OWNER_STATEMENT,
  PAYMENT_RECEIVED: DocumentKind.PAYMENT_RECEIPT,
}

/** Espera entre chequeos de un PDF que todavía no está listo. */
const ATTACHMENT_WAIT_SECONDS = 20

export interface DeliveryOptions {
  /** Reenvío manual: se deja constancia en la auditoría. */
  manual?: boolean
}

/**
 * Entrega un mail encolado (REDISENO_FASE_14, 2 y 2.1). Corre dentro del
 * tenant de la fila. Cada intento deja `attempts`, `next_attempt_at` y el
 * último error en `notification_log`; los reintentos los programa este
 * servicio (1, 5 y 30 minutos) y no la cola, porque dependen de si el error
 * es temporal.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = createLogger('NotificationDelivery')

  constructor(
    private readonly log: NotificationLogRepository,
    private readonly email: EmailPort,
    private readonly queue: QueuePort,
    private readonly tenants: TenantsFacade,
    private readonly documents: DocumentsFacade,
    private readonly templates: TemplateService,
    private readonly pipeline: NotificationPipeline,
    private readonly audit: AuditFacade,
  ) {}

  /** Hace un intento. Devuelve el estado en que quedó la fila (`null` si no existe). */
  async deliver(
    notificationId: string,
    options: DeliveryOptions = {},
  ): Promise<StatusName | null> {
    const row = await this.log.findById(notificationId)
    if (!row) return null
    // Un mensaje repetido de la cola (o uno ya resuelto): no se manda dos veces.
    if (row.status !== 'QUEUED') return row.status

    const to = row.recipientEmail
    const text = row.payload.bodyText
    if (!to || typeof text !== 'string' || !row.subject) {
      return (
        await this.fail(row, 'El mensaje no tiene destinatario o texto', 0)
      ).status
    }

    const branding = await this.tenants.branding(row.tenantId)
    const attached = await this.attachments(row)
    if (attached === 'WAIT') {
      const waits = Number(row.payload.attachmentWaits ?? 0) + 1
      await this.log.update(row.id, {
        payload: { ...row.payload, attachmentWaits: waits },
        nextAttemptAt: new Date(Date.now() + ATTACHMENT_WAIT_SECONDS * 1000),
      })
      await this.enqueue(row.id, ATTACHMENT_WAIT_SECONDS)
      return 'QUEUED'
    }

    const attempts = row.attempts + 1
    try {
      const result = await this.email.send({
        to,
        subject: row.subject,
        text,
        html: this.templates.layout(text, branding),
        replyTo: branding.email ?? undefined,
        fromName: branding.name,
        attachments: attached.length > 0 ? attached : undefined,
      })
      const sent = await this.log.update(row.id, {
        status: 'SENT',
        attempts,
        sentAt: new Date(),
        nextAttemptAt: null,
        error: null,
        providerMessageId: result.providerMessageId ?? null,
      })
      await this.auditSent(sent, options.manual ?? false)
      return 'SENT'
    } catch (error) {
      return (await this.failedAttempt(row, attempts, error)).status
    }
  }

  private async failedAttempt(
    row: NotificationRow,
    attempts: number,
    error: unknown,
  ): Promise<NotificationRow> {
    const message = errorMessage(error)
    // Un error que no sabemos clasificar se trata como temporal: reintentar
    // cuesta un mail; no reintentar puede dejar sin aviso a un propietario.
    const retryable =
      error instanceof EmailDeliveryError ? error.retryable : true
    const delay = retryable ? retryDelaySeconds(attempts) : null
    this.logger.warn(
      { notificationId: row.id, attempts, retryable, delay },
      `Falló la entrega del aviso ${row.type}: ${message}`,
    )

    if (delay === null) return this.fail(row, message, attempts)

    const updated = await this.log.update(row.id, {
      attempts,
      error: message,
      nextAttemptAt: new Date(Date.now() + delay * 1000),
    })
    await this.enqueue(row.id, delay)
    return updated
  }

  /** Fallo definitivo: `FAILED`, y si el tipo es crítico el personal se entera (A-52). */
  private async fail(
    row: NotificationRow,
    message: string,
    attempts: number,
  ): Promise<NotificationRow> {
    const failed = await this.log.update(row.id, {
      status: 'FAILED',
      attempts: attempts || row.attempts,
      error: message,
      nextAttemptAt: null,
    })
    if (findCatalogEntry(row.type)?.critical) {
      await this.pipeline.process({
        tenantId: row.tenantId,
        type: 'NOTIFICATION_FAILED',
        recipient: { kind: 'TENANT_STAFF' },
        entity: { type: 'NOTIFICATION', id: row.id },
        dedupeKey: `NOTIFICATION_FAILED:${row.id}:${failed.attempts}`,
        channels: ['IN_APP'],
        data: {
          title: 'No se pudo enviar un aviso importante',
          body: `${findCatalogEntry(row.type)?.title ?? row.type} para ${row.recipientEmail ?? 'un destinatario sin email'}: ${message}`,
          link: '/configuracion/notificaciones',
        },
      } as unknown as NotificationRequest)
    }
    return failed
  }

  /**
   * Los PDFs del tipo, si lleva. `WAIT` si el PDF todavía no está listo y
   * quedan esperas; pasadas las esperas el mail sale sin adjunto, con el link
   * al portal en el texto (A-59).
   */
  private async attachments(
    row: NotificationRow,
  ): Promise<EmailAttachment[] | 'WAIT'> {
    const kind = ATTACHMENT_KIND[row.type]
    if (!kind || !row.entityId) return []

    const pdf = await this.documents.currentPdf(kind, row.entityId)
    if (pdf.status === 'PENDING') {
      const waits = Number(row.payload.attachmentWaits ?? 0)
      return waits < MAX_ATTACHMENT_WAITS ? 'WAIT' : []
    }
    if (pdf.status === 'UNAVAILABLE') return []
    if (pdf.content.length > MAX_ATTACHMENT_BYTES) {
      this.logger.warn(
        { notificationId: row.id, bytes: pdf.content.length },
        'El PDF supera el tope de adjuntos: el mail sale sin adjunto',
      )
      return []
    }
    return [
      {
        filename: pdf.filename,
        content: pdf.content,
        contentType: pdf.contentType,
      },
    ]
  }

  private async enqueue(
    notificationId: string,
    delaySeconds: number,
  ): Promise<void> {
    try {
      await this.queue.publish<NotificationDeliverPayload>(
        NOTIFICATIONS_DELIVER_QUEUE,
        { notificationId },
        { startAfterSeconds: delaySeconds },
      )
    } catch (error) {
      // La fila queda QUEUED con `next_attempt_at`: "Reintentar fallidas" o un
      // reenvío manual la retoman. Se loguea para que no pase desapercibido.
      this.logger.error(
        { err: error, notificationId },
        'No se pudo programar el reintento de la entrega',
      )
    }
  }

  private auditSent(row: NotificationRow, manual: boolean): Promise<void> {
    return this.audit.record({
      action: 'NOTIFICATION_SENT',
      entity: 'Notification',
      entityId: row.id,
      summary: `${manual ? 'Reenvío manual: se' : 'Se'} envió el aviso ${row.type} (${row.recipientKind})`,
      changes: eventChanges({
        type: row.type,
        recipientKind: row.recipientKind,
        recipientId: row.recipientId,
        recipientEmail: row.recipientEmail,
        channels: row.payload.channels,
        entityType: row.entityType,
        entityId: row.entityId,
        attempts: row.attempts,
        manual,
      }),
      tenantId: row.tenantId,
      // Lo manda el sistema aunque lo haya disparado un usuario con un reenvío.
      userId: manual ? undefined : null,
      userEmail: manual ? undefined : null,
      actorKind: manual ? undefined : 'SYSTEM',
    })
  }
}
