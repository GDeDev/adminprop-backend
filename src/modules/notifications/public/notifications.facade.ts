import { Injectable } from '@nestjs/common'

import { NotificationConfigRepository } from '../domain/notification.ports'

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
}
