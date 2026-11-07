import {
  EmailDeliveryError,
  EmailMessage,
  EmailSendResult,
} from '../email.port'
import { ConsoleEmailAdapter } from './console.email-adapter'

/**
 * Doble de pruebas del proveedor real: falla las primeras `failures` veces con
 * un `EmailDeliveryError` y después anda. Sirve para verificar reintentos,
 * agotamiento y el aviso de fallo definitivo sin una cuenta de Resend.
 */
export class FlakyEmailAdapter extends ConsoleEmailAdapter {
  /** Cuántos envíos más tienen que fallar antes de que uno pase. */
  failures = 0
  retryable = true
  /** Intentos recibidos, con éxito o sin él. */
  attempts = 0

  failNext(count: number, options: { retryable?: boolean } = {}): void {
    this.failures = count
    this.retryable = options.retryable ?? true
  }

  override async send(message: EmailMessage): Promise<EmailSendResult> {
    this.attempts += 1
    if (this.failures > 0) {
      this.failures -= 1
      throw new EmailDeliveryError(
        this.retryable ? 'Rate limit del proveedor' : 'Dirección inválida',
        this.retryable,
        this.retryable ? 'rate_limit_exceeded' : 'validation_error',
      )
    }
    return super.send(message)
  }
}
