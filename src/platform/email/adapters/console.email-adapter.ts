import { createLogger } from '@/shared/logging/root-logger'
import { EmailMessage, EmailPort } from '../email.port'

/**
 * `EmailPort` que no envía nada: loguea el email (`EMAIL_PROVIDER=console`).
 *
 * Para desarrollo y tests. Guarda lo "enviado" en `sent` para que un test
 * pueda verificar qué se mandó sin mockear nada.
 */
export class ConsoleEmailAdapter extends EmailPort {
  private readonly logger = createLogger('Email')
  readonly sent: EmailMessage[] = []

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message)
    // Destinatario y asunto a info; el cuerpo, sólo en debug: puede tener datos
    // personales que no queremos en los logs de un entorno compartido.
    this.logger.info(
      { operation: 'email_sent', to: message.to, subject: message.subject },
      `Email (consola): ${message.subject}`,
    )
    this.logger.debug({ text: message.text }, 'Cuerpo del email')
  }
}
