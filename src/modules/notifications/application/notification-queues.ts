import { QueueDefinition } from '@/platform/queue/queue.port'

/**
 * Entrega de un mail. Los reintentos de negocio (1, 5 y 30 minutos) los
 * programa el propio servicio con `startAfterSeconds`; el `retryLimit` de la
 * cola sólo cubre un fallo de infraestructura (la base caída a mitad de
 * camino), no un rechazo del proveedor.
 */
export const NOTIFICATIONS_DELIVER_QUEUE: QueueDefinition = {
  name: 'notifications-deliver',
  retryLimit: 3,
  retryDelaySeconds: 30,
}

export interface NotificationDeliverPayload {
  notificationId: string
}

/** "Reintentar todas las fallidas" (`POST /notifications/resend-failed`). */
export const NOTIFICATIONS_RESEND_FAILED_QUEUE: QueueDefinition = {
  name: 'notifications-resend-failed',
  retryLimit: 1,
  retryDelaySeconds: 30,
}

export interface NotificationsResendFailedPayload {
  jobId: string
  type?: string
  from?: string
  to?: string
}

export const RESEND_FAILED_JOB_TYPE = 'notifications-resend-failed'
