import { Injectable } from '@nestjs/common'

import { RequestContext } from '@/shared/context/request-context'
import { NotificationsPipeline, SendOutcome } from './notifications-pipeline'
import {
  NotificationChannel,
  NotificationRecipientKind,
  NotificationRequest,
  NotificationType,
} from './notifications.port'

export type { SendOutcome }

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
 * Lo único que los jobs y los consumidores llaman para avisar (Fase 13, 4). La
 * firma de `send` no cambió en la Fase 14: lo que cambió es lo que hay detrás
 * (`NotificationsPipeline`): dedupe por clave, preferencias, plantilla,
 * historial en `notification_log` y entrega con reintentos.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly pipeline: NotificationsPipeline) {}

  send(request: NotificationRequest): Promise<SendOutcome> {
    return RequestContext.runInTenant(request.tenantId, () =>
      this.pipeline.process(request),
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
}
