import { NotificationRequest } from './notifications.port'

export type SendOutcome = 'SENT' | 'SKIPPED' | 'FAILED'

/**
 * Lo que hay detrás de `NotificationsService.send` (Fase 14): dedupe,
 * preferencias, plantilla y cola de entrega. Vive en `modules/notifications`,
 * que sí puede hablar con auth, tenants y documentos; `platform` no puede, y
 * por eso el servicio sólo conoce este puerto.
 *
 * `SENT` quiere decir "aceptado": el mensaje quedó en la cola de entrega, que
 * es asincrónica. `SKIPPED`, que ya estaba avisado o que una preferencia lo
 * descartó. `FAILED`, que no se pudo ni encolar.
 */
export abstract class NotificationsPipeline {
  abstract process(request: NotificationRequest): Promise<SendOutcome>
}
