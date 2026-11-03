/**
 * API pública de notificaciones: el módulo (para `app.module`) y la facade con
 * las preferencias personales. Los avisos se disparan con
 * `NotificationsService` de `platform/notifications`, no desde acá.
 */
export { NotificationsModule } from '../infrastructure/modules/notifications.module'
export { NotificationsFacade } from './notifications.facade'
