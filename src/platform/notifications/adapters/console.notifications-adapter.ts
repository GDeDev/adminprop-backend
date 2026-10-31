import { createLogger } from '@/shared/logging/root-logger'
import {
  NotificationRequest,
  NotificationResult,
  NotificationsPort,
  NotificationStatus,
} from '../notifications.port'

/**
 * `NotificationsPort` que no envía nada: loguea el aviso
 * (`NOTIFICATIONS_PROVIDER=console`). Es el default y el que usan los tests,
 * que leen `sent` para verificar qué se hubiera mandado.
 */
export class ConsoleNotificationsAdapter extends NotificationsPort {
  private readonly logger = createLogger('Notifications')
  readonly sent: NotificationRequest[] = []

  async send(request: NotificationRequest): Promise<NotificationResult> {
    this.sent.push(request)
    // Sin los datos de la plantilla: pueden tener nombres y montos.
    this.logger.info(
      {
        operation: 'notification_sent',
        type: request.type,
        recipientKind: request.recipient.kind,
        channels: request.channels,
        dedupeKey: request.dedupeKey,
      },
      `Aviso (consola): ${request.type}`,
    )
    return { status: NotificationStatus.SENT }
  }
}
