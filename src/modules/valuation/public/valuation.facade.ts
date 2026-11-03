import { Injectable } from '@nestjs/common'
import { CommandBus } from '@nestjs/cqrs'

import {
  ComparablesRefreshService,
  RefreshSummary,
} from '../application/comparables-refresh.service'
import {
  AppraiseInput,
  AppraisePropertyCommand,
} from '../application/valuation.commands'
import { ValuationSettings } from '../application/valuation.support'
import { ValuationView } from '../application/valuation.views'

export type { AppraiseInput, RefreshSummary, ValuationView }

/**
 * Lo que otros módulos pueden pedirle a la tasación. Hoy lo usa sólo
 * automatizaciones (el job global de refresco); el controller va por el bus.
 */
@Injectable()
export class ValuationFacade {
  constructor(
    private readonly commands: CommandBus,
    private readonly refresh: ComparablesRefreshService,
    private readonly settings: ValuationSettings,
  ) {}

  /** Tasa una propiedad de la inmobiliaria del contexto. */
  appraise(propertyId: string, input: AppraiseInput): Promise<ValuationView> {
    return this.commands.execute(new AppraisePropertyCommand(propertyId, input))
  }

  /**
   * El job global: trae avisos para las zonas más atrasadas, hasta
   * `VALUATION_ZONES_PER_RUN`. Fuera de cualquier request y sin tenant.
   */
  refreshComparables(now: Date = new Date()): Promise<RefreshSummary> {
    return this.refresh.runScheduled(now, this.settings.values.zonesPerRun)
  }
}
