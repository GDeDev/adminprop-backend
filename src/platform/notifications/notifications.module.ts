import { Global, Module } from '@nestjs/common'

import { ConsoleNotificationsAdapter } from './adapters/console.notifications-adapter'
import { NotificationsPort } from './notifications.port'
import { NotificationsService } from './notifications.service'

/**
 * Registra el `NotificationsPort`. Hoy `NOTIFICATIONS_PROVIDER` sólo admite
 * `console`; el adapter de Novu + Resend se suma en la Fase 14 con su `case`
 * acá (leyendo `notifications.provider` de la config). Global: cualquier
 * módulo puede inyectar `NotificationsService`.
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
