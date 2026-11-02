import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { eventChanges, writeAuditEvent } from '@/shared/audit/audit-event'
import { RequestContext } from '@/shared/context/request-context'
import { errorMessage } from '@/shared/core/error-message'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  NotificationChannel,
  NotificationRecipientKind,
  NotificationRequest,
  NotificationsPort,
  NotificationStatus,
  NotificationType,
} from './notifications.port'

export type SendOutcome = 'SENT' | 'SKIPPED' | 'FAILED'

/** Un aviso interno para el personal de la inmobiliaria (campana del backoffice). */
export interface InternalAlertRequest {
  tenantId: string
  type: NotificationType
  title: string
  body: string
  dedupeKey: string
  entity?: { type: string; id: string }
  /** Ruta relativa del backoffice (`/contratos/<id>`). */
  link?: string
}

/**
 * Lo único que los jobs llaman para avisar (Fase 13, 4). Mira
 * `notification_log` por la clave de deduplicación: si ya existe, no manda
 * (`SKIPPED`); si no, escribe `QUEUED`, llama al puerto y deja el resultado.
 * Un aviso que falló se reintenta la próxima vez (la fila queda `FAILED`);
 * uno enviado, nunca se repite.
 *
 * Una fila por aviso, con el primer canal como `channel` y la lista completa
 * en el payload (D-95).
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly port: NotificationsPort,
    private readonly prisma: PrismaService,
  ) {}

  send(request: NotificationRequest): Promise<SendOutcome> {
    return RequestContext.runInTenant(request.tenantId, () =>
      this.sendInTenant(request),
    )
  }

  /**
   * Aviso interno `IN_APP` al personal: sólo deja la fila (con título, texto
   * y link en el payload) y queda como enviado. Lo lee `GET /automations/alerts`.
   */
  notifyStaff(alert: InternalAlertRequest): Promise<SendOutcome> {
    return this.send({
      tenantId: alert.tenantId,
      type: alert.type,
      recipient: { kind: NotificationRecipientKind.TENANT_STAFF },
      entity: alert.entity,
      dedupeKey: alert.dedupeKey,
      channels: [NotificationChannel.IN_APP],
      data: {
        title: alert.title,
        body: alert.body,
        link: alert.link ?? null,
      },
    })
  }

  private async sendInTenant(
    request: NotificationRequest,
  ): Promise<SendOutcome> {
    const existing = await this.prisma.db.notificationLog.findUnique({
      where: {
        tenantId_dedupeKey: {
          tenantId: request.tenantId,
          dedupeKey: request.dedupeKey,
        },
      },
    })
    if (existing && existing.status !== NotificationStatus.FAILED) {
      return 'SKIPPED'
    }

    const id = existing?.id ?? (await this.createQueued(request))
    // Otro proceso la creó entre el chequeo y el alta.
    if (id === null) return 'SKIPPED'

    const outbound = request.channels.filter(
      (channel) => channel !== NotificationChannel.IN_APP,
    )
    let status: SendOutcome = 'SENT'
    let error: string | null = null
    if (outbound.length > 0) {
      try {
        const result = await this.port.send({ ...request, channels: outbound })
        status = result.status
        error = result.error ?? null
      } catch (e) {
        status = 'FAILED'
        error = errorMessage(e)
      }
    }

    await this.prisma.db.notificationLog.update({
      where: { id },
      data: {
        status,
        error,
        sentAt: status === 'SENT' ? new Date() : null,
      },
    })

    // Los avisos internos (IN_APP) no salen a nadie: sólo los envíos reales.
    if (status === 'SENT' && outbound.length > 0) {
      await this.auditSent(id, request, outbound)
    }
    return status
  }

  /** Deja constancia del envío (Fase 20): quién lo recibió, qué tipo y por qué canal. */
  private auditSent(
    id: string,
    request: NotificationRequest,
    channels: NotificationChannel[],
  ): Promise<void> {
    return writeAuditEvent(this.prisma, {
      action: 'NOTIFICATION_SENT',
      entity: 'Notification',
      entityId: id,
      summary: `Se envió el aviso ${request.type} (${request.recipient.kind})`,
      changes: eventChanges({
        type: request.type,
        recipientKind: request.recipient.kind,
        recipientId: request.recipient.id,
        recipientEmail: request.recipient.email,
        channels,
        entityType: request.entity?.type,
        entityId: request.entity?.id,
      }),
      tenantId: request.tenantId,
      // Lo manda el sistema aunque lo haya disparado un usuario con una corrida manual.
      userId: null,
      userEmail: null,
      actorKind: 'SYSTEM',
    })
  }

  /** Crea la fila `QUEUED`; `null` si la clave ya existe (carrera entre dos procesos). */
  private async createQueued(
    request: NotificationRequest,
  ): Promise<string | null> {
    try {
      const row = await this.prisma.db.notificationLog.create({
        data: {
          type: request.type,
          recipientKind: request.recipient.kind,
          recipientId: request.recipient.id ?? null,
          recipientEmail: request.recipient.email ?? null,
          entityType: request.entity?.type ?? null,
          entityId: request.entity?.id ?? null,
          dedupeKey: request.dedupeKey,
          channel: request.channels[0],
          status: NotificationStatus.QUEUED,
          payload: {
            channels: request.channels,
            phone: request.recipient.phone ?? null,
            ...request.data,
          } as Prisma.InputJsonValue,
        } as Prisma.NotificationLogUncheckedCreateInput,
      })
      return row.id
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null
      }
      throw error
    }
  }
}
