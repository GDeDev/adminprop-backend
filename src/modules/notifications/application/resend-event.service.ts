import { Injectable } from '@nestjs/common'

import { NotificationRequest } from '@/platform/notifications/notifications.port'
import { RequestContext } from '@/shared/context/request-context'
import { createLogger } from '@/shared/logging/root-logger'
import {
  EmailEventRepository,
  EmailEventTypeName,
  NotificationLogRepository,
} from '../domain/notification.ports'
import { NotificationPipeline } from './notification.pipeline'

export interface IncomingEmailEvent {
  providerMessageId: string
  type: EmailEventTypeName
  occurredAt: Date
  recipientEmail: string | null
  payloadRaw: unknown
}

/**
 * Registra los eventos que reporta el proveedor de email (REDISENO_FASE_14, 4).
 * El evento llega sin tenant: se busca el mensaje por su id de proveedor y
 * recién ahí se entra al tenant correspondiente. Un id desconocido se descarta
 * con un log (A-56); uno repetido no duplica nada.
 */
@Injectable()
export class ResendEventService {
  private readonly logger = createLogger('ResendEvents')

  constructor(
    private readonly log: NotificationLogRepository,
    private readonly events: EmailEventRepository,
    private readonly pipeline: NotificationPipeline,
  ) {}

  /** `true` si el evento era nuevo y quedó guardado. */
  async record(event: IncomingEmailEvent): Promise<boolean> {
    const notification = await this.log.findByProviderMessageIdAcrossTenants(
      event.providerMessageId,
    )
    if (!notification) {
      this.logger.warn(
        { providerMessageId: event.providerMessageId, type: event.type },
        'Evento de email de un mensaje desconocido: se descarta',
      )
      return false
    }

    return RequestContext.runInTenant(notification.tenantId, async () => {
      const inserted = await this.events.insertIfNew({
        tenantId: notification.tenantId,
        notificationId: notification.id,
        providerMessageId: event.providerMessageId,
        type: event.type,
        recipientEmail: event.recipientEmail ?? notification.recipientEmail,
        payloadRaw: event.payloadRaw,
        occurredAt: event.occurredAt,
      })
      if (
        inserted &&
        (event.type === 'BOUNCED' || event.type === 'COMPLAINED')
      ) {
        await this.alertBounce(notification.id, notification.tenantId, event)
      }
      return inserted
    })
  }

  /** Una sola vez por mensaje, aunque lleguen un rebote y una queja. */
  private async alertBounce(
    notificationId: string,
    tenantId: string,
    event: IncomingEmailEvent,
  ): Promise<void> {
    const who = event.recipientEmail ?? 'un destinatario'
    await this.pipeline.process({
      tenantId,
      type: 'EMAIL_BOUNCED',
      recipient: { kind: 'TENANT_STAFF' },
      entity: { type: 'NOTIFICATION', id: notificationId },
      dedupeKey: `EMAIL_BOUNCED:${notificationId}`,
      channels: ['IN_APP'],
      data: {
        title: 'Un email no llegó a destino',
        body:
          event.type === 'COMPLAINED'
            ? `${who} marcó el mail como spam. Revisá si el contacto quiere recibir avisos.`
            : `El mail a ${who} rebotó. Corregí el email cargado.`,
        link: '/configuracion/notificaciones',
      },
    } as unknown as NotificationRequest)
  }
}
