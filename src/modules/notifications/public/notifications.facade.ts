import { Injectable } from '@nestjs/common'

import { fillTemplate } from '@/shared/whatsapp/whatsapp'
import { NotificationConfigRepository } from '../domain/notification.ports'
import { findDefaultWhatsAppTemplate } from '../domain/whatsapp-templates'

/**
 * Lo que otros módulos pueden preguntarle a notificaciones (Fase 14). Corre
 * dentro del tenant del contexto.
 */
@Injectable()
export class NotificationsFacade {
  constructor(private readonly config: NotificationConfigRepository) {}

  /**
   * Los tipos de aviso interno que un usuario apagó para su campana. El aviso
   * interno es una sola fila para todo el personal; la preferencia personal se
   * aplica al leerlo, no al crearlo.
   */
  inAppOptOutTypes(userId: string): Promise<string[]> {
    return this.config.typesWithInAppOptOut(userId)
  }

  /**
   * El texto de una plantilla de WhatsApp (la de la inmobiliaria si la editó, si
   * no la de código) con las variables resueltas; null si la clave no existe.
   * El CRM arma con esto el link `wa.me` (Fase 23).
   */
  async renderWhatsApp(
    key: string,
    values: Record<string, string | null | undefined>,
  ): Promise<string | null> {
    const template = findDefaultWhatsAppTemplate(key)
    if (!template) return null
    const override = (await this.config.listWhatsApp()).find(
      (row) => row.key === key,
    )
    return fillTemplate(override?.body ?? template.body, values)
  }
}
