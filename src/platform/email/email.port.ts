/**
 * Envío de emails (spec Fase 1, sección 5.2).
 *
 * Hoy sólo existe el adapter de consola: el proveedor real (Resend vía Novu)
 * llega con las notificaciones, en la Fase 14. Quien envía un email ya puede
 * depender de este puerto; ese día sólo cambia `EMAIL_PROVIDER`.
 *
 * Clase abstracta y no interface para usarla como token de inyección.
 */
export abstract class EmailPort {
  abstract send(message: EmailMessage): Promise<void>
}

export interface EmailMessage {
  to: string | string[]
  subject: string
  /** Versión en texto plano: obligatoria, la leen clientes sin HTML y filtros de spam. */
  text: string
  html?: string
  replyTo?: string
}
