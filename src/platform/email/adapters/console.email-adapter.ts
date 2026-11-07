import { randomUUID } from 'node:crypto'

import { createLogger } from '@/shared/logging/root-logger'
import { EmailMessage, EmailPort, EmailSendResult } from '../email.port'

/**
 * `EmailPort` que no envía nada: loguea el email (`EMAIL_PROVIDER=console`).
 *
 * Para desarrollo y tests. Guarda lo "enviado" en `sent` para que un test
 * pueda verificar qué se mandó sin mockear nada. Devuelve un id de mensaje
 * propio (`console_<uuid>`) para que el resto del circuito (webhook simulado,
 * historial) se pueda recorrer sin Resend.
 */
export class ConsoleEmailAdapter extends EmailPort {
  private readonly logger = createLogger('Email')
  readonly sent: EmailMessage[] = []
  /** Id de proveedor de cada mensaje de `sent`, en el mismo orden. */
  readonly messageIds: string[] = []

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(message)
    const providerMessageId = `console_${randomUUID()}`
    this.messageIds.push(providerMessageId)
    // Destinatario y asunto a info; el cuerpo, sólo en debug: puede tener datos
    // personales que no queremos en los logs de un entorno compartido.
    this.logger.info(
      {
        operation: 'email_sent',
        to: message.to,
        subject: message.subject,
        attachments: message.attachments?.map((a) => a.filename),
      },
      `Email (consola): ${message.subject}`,
    )
    this.logger.debug({ text: message.text }, 'Cuerpo del email')
    return { providerMessageId }
  }
}
