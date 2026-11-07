import { Injectable } from '@nestjs/common'

import { AlertRepository } from '../domain/automations.ports'
import {
  ALERT_TYPES,
  ALERT_WINDOW_DAYS,
} from '../application/automation.handlers'

/**
 * Lo que otros módulos pueden pedirle a automatizaciones (dashboard de la
 * Fase 19). Dentro del tenant del contexto.
 */
@Injectable()
export class AutomationsFacade {
  constructor(private readonly alerts: AlertRepository) {}

  /** Avisos internos sin leer de la ventana de la campana (últimos 30 días). */
  async countUnreadAlerts(): Promise<number> {
    const since = new Date(Date.now() - ALERT_WINDOW_DAYS * 86_400_000)
    const [, total] = await this.alerts.list(
      { unreadOnly: true, since, types: ALERT_TYPES },
      { skip: 0, take: 1 },
    )
    return total
  }
}
