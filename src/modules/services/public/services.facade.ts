import { Injectable } from '@nestjs/common'

import { IsoDate, todayIso } from '@/shared/dates/calendar-date'
import { ServicePolicy } from '../domain/service.policy'
import { PropertyServiceRepository } from '../domain/service.ports'

/** Un servicio vencido, para las alertas de la Fase 13 (RN-13). */
export interface OverdueServiceRef {
  id: string
  propertyId: string
  contractId: string | null
  serviceTypeId: string
  dueDate: IsoDate
  /** Venció ayer = 1. La alerta sale a partir del 5° día. */
  daysOverdue: number
}

/**
 * Lo que otros módulos pueden pedirle a servicios. Dentro del tenant del
 * contexto; el cron de la Fase 13 entra por inmobiliaria con
 * `RequestContext.runInTenant`.
 */
@Injectable()
export class ServicesFacade {
  constructor(private readonly services: PropertyServiceRepository) {}

  /** Todos los vencidos a esa fecha, los más atrasados primero. */
  async listOverdue(today: IsoDate = todayIso()): Promise<OverdueServiceRef[]> {
    const [services] = await this.services.listOverdue(today, {})
    return services.flatMap((service) =>
      service.dueDate === null
        ? []
        : [
            {
              id: service.id,
              propertyId: service.propertyId,
              contractId: service.contractId,
              serviceTypeId: service.serviceTypeId,
              dueDate: service.dueDate,
              daysOverdue: ServicePolicy.daysOverdue(
                service.hasDueDate,
                service.dueDate,
                today,
              ),
            },
          ],
    )
  }

  countByProperty(propertyId: string): Promise<number> {
    return this.services.countByProperty(propertyId)
  }
}
