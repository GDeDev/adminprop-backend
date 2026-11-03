import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  SvixHeaders,
  verifySvixSignature,
} from '@/platform/email/svix-signature'
import { Configuration } from '@/shared/config/configuration'
import { AppException } from '@/shared/errors'
import { createLogger } from '@/shared/logging/root-logger'
import { EmailEventTypeName } from '../domain/notification.ports'
import { ResendEventService } from './resend-event.service'

/** Eventos de Resend que nos interesan, y a qué tipo propio corresponden. */
const EVENT_TYPES: Record<string, EmailEventTypeName> = {
  'email.sent': 'SENT',
  'email.delivered': 'DELIVERED',
  'email.opened': 'OPENED',
  'email.clicked': 'CLICKED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINED',
  'email.delivery_delayed': 'DELAYED',
}

interface ResendWebhookBody {
  type?: string
  created_at?: string
  data?: { email_id?: string; to?: string[] | string }
}

/**
 * Webhook de Resend (REDISENO_FASE_14, 4): verifica la firma Svix sobre el
 * cuerpo crudo y guarda el evento. Responde apenas guarda; un evento repetido,
 * de un mensaje desconocido o de un tipo que no usamos se acepta y se ignora,
 * para que el proveedor no reintente indefinidamente.
 */
@Injectable()
export class ResendWebhookService {
  private readonly logger = createLogger('ResendWebhook')

  constructor(
    private readonly events: ResendEventService,
    private readonly config: ConfigService<Configuration, true>,
  ) {}

  async handle(
    rawBody: Buffer | undefined,
    headers: SvixHeaders,
  ): Promise<{ recorded: boolean }> {
    const secret = this.config.get('email', { infer: true }).resendWebhookSecret
    if (!secret || !rawBody) {
      throw AppException.unauthorized('El webhook no está configurado')
    }
    const body = rawBody.toString('utf8')
    if (!verifySvixSignature(secret, headers, body)) {
      throw AppException.unauthorized('Firma inválida')
    }

    let payload: ResendWebhookBody
    try {
      payload = JSON.parse(body) as ResendWebhookBody
    } catch {
      throw AppException.badRequest('El cuerpo no es JSON')
    }

    const type = EVENT_TYPES[payload.type ?? '']
    const emailId = payload.data?.email_id
    if (!type || !emailId) {
      this.logger.info({ type: payload.type }, 'Evento de Resend ignorado')
      return { recorded: false }
    }

    const to = payload.data?.to
    const parsed = payload.created_at ? new Date(payload.created_at) : null
    const recorded = await this.events.record({
      providerMessageId: emailId,
      type,
      occurredAt:
        parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(),
      recipientEmail: (Array.isArray(to) ? to[0] : to) ?? null,
      payloadRaw: payload,
    })
    return { recorded }
  }
}
