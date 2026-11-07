/**
 * Envío de emails (spec Fase 1, sección 5.2).
 *
 * Dos adapters: consola (desarrollo y tests, `EMAIL_PROVIDER=console`) y
 * Resend (`EMAIL_PROVIDER=resend`, Fase 14). Quien envía un email sólo
 * depende de este puerto.
 *
 * Clase abstracta y no interface para usarla como token de inyección.
 */
export abstract class EmailPort {
  /**
   * Envía el mensaje. Un fallo del proveedor se lanza como
   * `EmailDeliveryError`, que dice si vale la pena reintentar (A-51).
   */
  abstract send(message: EmailMessage): Promise<EmailSendResult>
}

export interface EmailAttachment {
  filename: string
  content: Buffer
  contentType: string
}

export interface EmailMessage {
  to: string | string[]
  subject: string
  /** Versión en texto plano: obligatoria, la leen clientes sin HTML y filtros de spam. */
  text: string
  html?: string
  replyTo?: string
  /** Nombre visible del remitente (la razón social de la inmobiliaria). */
  fromName?: string
  /** Tope de 10 MB entre todos (A-59); lo controla quien arma el mensaje. */
  attachments?: EmailAttachment[]
}

export interface EmailSendResult {
  /** Id que asigna el proveedor; une los eventos del webhook con el envío. */
  providerMessageId?: string
}

/**
 * Falla de entrega. `retryable` separa lo temporal (rate limit, timeout, 5xx)
 * de lo definitivo (dirección inválida, dominio sin verificar, 4xx): reintentar
 * lo segundo sólo repite el error.
 */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code: string = 'EMAIL_DELIVERY_ERROR',
  ) {
    super(message)
    this.name = 'EmailDeliveryError'
  }
}
