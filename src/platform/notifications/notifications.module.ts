import { Global, Module } from '@nestjs/common'

import { ConsoleNotificationsAdapter } from './adapters/console.notifications-adapter'
import { NotificationsPort } from './notifications.port'
import { NotificationsService } from './notifications.service'

/**
 * Registra el `NotificationsService`, la entrada que usa todo el sistema para
 * avisar. El `NotificationsPipeline` que usa por dentro lo provee
 * `NotificationsModule` de `modules/notifications` (Fase 14).
 *
 * `NotificationsPort` queda registrado como la costura para un proveedor
 * completo de notificaciones (Novu, A-50): hoy sólo existe el adapter de
 * consola y la entrega pasa por `EmailPort`. Global: cualquier módulo puede
 * inyectar `NotificationsService`.
 */
@Global()
@Module({
  providers: [
    {
      provide: NotificationsPort,
      useFactory: (): NotificationsPort => new ConsoleNotificationsAdapter(),
    },
    NotificationsService,
  ],
  exports: [NotificationsPort, NotificationsService],
})
export class NotificationsModule {}
