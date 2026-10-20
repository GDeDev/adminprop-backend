import { Injectable } from '@nestjs/common'

import { IsoDate, todayIso } from '@/shared/dates/calendar-date'
import { sumOf } from '../application/advance-expense.views'
import { ServicePolicy } from '../domain/service.policy'
import {
  AdvanceExpenseRepository,
  PropertyServiceRepository,
} from '../domain/service.ports'
import { Currency } from '../domain/property-service'

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

/** Un gasto pendiente, para la liquidación (Fase 12, RN-11). */
export interface PendingExpenseRef {
  id: string
  contractId: string
  renterId: string
  amount: string
  currency: Currency
  description: string
  expenseDate: IsoDate
}

/**
 * Lo que otros módulos pueden pedirle a servicios. Dentro del tenant del
 * contexto; el cron de la Fase 13 entra por inmobiliaria con
 * `RequestContext.runInTenant`.
 */
@Injectable()
export class ServicesFacade {
  constructor(
    private readonly services: PropertyServiceRepository,
    private readonly expenses: AdvanceExpenseRepository,
  ) {}

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

  /** Los gastos sin descontar de un contrato y su suma. */
  async pendingExpensesByContract(
    contractId: string,
  ): Promise<{ total: string; items: PendingExpenseRef[] }> {
    const pending = await this.expenses.list({ contractId, settled: false })
    return {
      total: sumOf(pending),
      items: pending.map((expense) => ({
        id: expense.id,
        contractId: expense.contractId,
        renterId: expense.renterId,
        amount: expense.amount,
        currency: expense.currency,
        description: expense.description,
        expenseDate: expense.expenseDate,
      })),
    }
  }

  /**
   * La liquidación (Fase 12) marca los gastos que descontó. Sólo toca los
   * pendientes; devuelve cuántos marcó. Desde ese momento son inmutables.
   */
  markExpensesSettled(
    ids: string[],
    settlementId: string,
    settledAt: Date = new Date(),
  ): Promise<number> {
    return this.expenses.markSettled(ids, settlementId, settledAt)
  }
}
