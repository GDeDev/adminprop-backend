import { createLogger } from '@/shared/logging/root-logger'
import {
  EmailDeliveryError,
  EmailMessage,
  EmailPort,
  EmailSendResult,
} from '../email.port'

export const RESEND_API_URL = 'https://api.resend.com/emails'

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/**
 * `EmailPort` sobre la API HTTP de Resend (`EMAIL_PROVIDER=resend`). Sin SDK:
 * un POST alcanza y evita una dependencia más para un solo endpoint.
 *
 * Clasifica los errores para los reintentos (A-51): timeout, red, 429 y 5xx
 * son temporales; el resto de los 4xx (dirección inválida, dominio sin
 * verificar, API key mala) no se arreglan reintentando.
 */
export class ResendEmailAdapter extends EmailPort {
  private readonly logger = createLogger('ResendEmail')

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: FetchLike = fetch,
    private readonly timeoutMs = 15_000,
  ) {
    super()
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const sender = message.fromName
      ? `${message.fromName.replace(/[<>"]/g, '')} <${this.from}>`
      : this.from

    let response: Response
    try {
      response = await this.fetchFn(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: sender,
          to: Array.isArray(message.to) ? message.to : [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          reply_to: message.replyTo,
          attachments: message.attachments?.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.content.toString('base64'),
          })),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      // Corte de red o timeout: el mensaje puede no haber salido.
      throw new EmailDeliveryError(
        error instanceof Error ? error.message : 'Error de red con Resend',
        true,
        'network_error',
      )
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const retryable = response.status === 429 || response.status >= 500
      this.logger.warn(
        { status: response.status, retryable },
        'Resend rechazó el envío',
      )
      throw new EmailDeliveryError(
        `Resend respondió ${response.status}: ${detail.slice(0, 300)}`,
        retryable,
        `resend_${response.status}`,
      )
    }

    const body = (await response.json().catch(() => ({}))) as { id?: string }
    return { providerMessageId: body.id }
  }
}
