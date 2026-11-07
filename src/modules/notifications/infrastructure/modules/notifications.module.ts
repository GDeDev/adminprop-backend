import { Global, Module } from '@nestjs/common'

import { AuditRecorderModule } from '@/modules/audit/public'
import { BillingModule } from '@/modules/billing/public'
import { ContractsModule } from '@/modules/contracts/public'
import { DocumentsModule } from '@/modules/documents/public'
import { JobsModule } from '@/modules/jobs/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesModule } from '@/modules/properties/public'
import { RentersModule } from '@/modules/renters/public'
import { SettlementsModule } from '@/modules/settlements/public'
import { TenantsModule } from '@/modules/tenants/public'
import { NotificationsPipeline } from '@/platform/notifications/notifications-pipeline'
import {
  GetNotificationHandler,
  ListNotificationsHandler,
  ResendFailedHandler,
  ResendFailedRunner,
  ResendNotificationHandler,
  SimulateEmailEventHandler,
} from '../../application/notification.handlers'
import {
  GetMyPreferencesHandler,
  ListNotificationSettingsHandler,
  ListNotificationTemplatesHandler,
  ListWhatsAppTemplatesHandler,
  PreviewTemplateHandler,
  ResetNotificationTemplateHandler,
  SendTemplateTestHandler,
  UpdateMyPreferencesHandler,
  UpdateNotificationSettingsHandler,
  UpdateNotificationTemplateHandler,
  UpdateWhatsAppTemplateHandler,
} from '../../application/notification-config.handlers'
import { NotificationDeliveryService } from '../../application/notification-delivery.service'
import { NotificationPipeline } from '../../application/notification.pipeline'
import { ResendEventService } from '../../application/resend-event.service'
import { ResendWebhookService } from '../../application/resend-webhook.service'
import { TemplateService } from '../../application/template.service'
import {
  EmailEventRepository,
  NotificationConfigRepository,
  NotificationLogRepository,
} from '../../domain/notification.ports'
import { NotificationsFacade } from '../../public/notifications.facade'
import { NotificationDeliveryConsumer } from '../consumers/notification-delivery.consumer'
import { NotificationEventsConsumer } from '../consumers/notification-events.consumer'
import { NotificationsController } from '../http/controllers/notifications.controller'
import { WebhooksController } from '../http/controllers/webhooks.controller'
import { NotificationConfigRepositoryImpl } from '../repositories/notification-config.repository.impl'
import {
  EmailEventRepositoryImpl,
  NotificationLogRepositoryImpl,
} from '../repositories/notification-log.repository.impl'

/**
 * Notificaciones y mailing (Fase 14): lo que hay detrás de
 * `NotificationsService.send` (dedupe, preferencias, plantillas, cola de
 * entrega con reintentos), el historial, la configuración y el webhook del
 * proveedor de email.
 *
 * Es `@Global()` por una sola razón: `NotificationsService` (en `platform`, que
 * no puede importar módulos) necesita el `NotificationsPipeline` que se provee
 * acá.
 */
@Global()
@Module({
  imports: [
    TenantsModule,
    DocumentsModule,
    JobsModule,
    AuditRecorderModule,
    OwnersModule,
    RentersModule,
    ContractsModule,
    PropertiesModule,
    // Sólo por las colas de eventos que consume (constantes del `public/`).
    BillingModule,
    SettlementsModule,
  ],
  controllers: [NotificationsController, WebhooksController],
  providers: [
    {
      provide: NotificationLogRepository,
      useClass: NotificationLogRepositoryImpl,
    },
    { provide: EmailEventRepository, useClass: EmailEventRepositoryImpl },
    {
      provide: NotificationConfigRepository,
      useClass: NotificationConfigRepositoryImpl,
    },
    TemplateService,
    NotificationPipeline,
    { provide: NotificationsPipeline, useExisting: NotificationPipeline },
    NotificationDeliveryService,
    ResendEventService,
    ResendWebhookService,
    ResendFailedRunner,
    NotificationDeliveryConsumer,
    NotificationEventsConsumer,
    NotificationsFacade,
    ListNotificationsHandler,
    GetNotificationHandler,
    ResendNotificationHandler,
    ResendFailedHandler,
    SimulateEmailEventHandler,
    ListNotificationSettingsHandler,
    UpdateNotificationSettingsHandler,
    ListNotificationTemplatesHandler,
    UpdateNotificationTemplateHandler,
    ResetNotificationTemplateHandler,
    PreviewTemplateHandler,
    SendTemplateTestHandler,
    GetMyPreferencesHandler,
    UpdateMyPreferencesHandler,
    ListWhatsAppTemplatesHandler,
    UpdateWhatsAppTemplateHandler,
  ],
  exports: [NotificationsPipeline, NotificationsFacade],
})
export class NotificationsModule {}
