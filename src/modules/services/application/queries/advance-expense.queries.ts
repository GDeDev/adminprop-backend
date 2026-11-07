import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { ContractsFacade } from '@/modules/contracts/public'
import { ExpenseContractNotFoundException } from '@/modules/services/domain/service.exceptions'
import { AdvanceExpenseRepository } from '@/modules/services/domain/service.ports'
import {
  AdvanceExpenseListView,
  AdvanceExpenseViews,
} from '../advance-expense.views'

export class ListAdvanceExpensesQuery {
  constructor(
    public readonly contractId: string,
    /** Sólo descontados (`true`) o sólo pendientes (`false`). */
    public readonly settled?: boolean,
  ) {}
}

/**
 * Spec 3.2: los gastos de un contrato con el filtro `settled`, y los
 * totales pendiente/descontado del contrato entero (spec 6, último
 * criterio), que no dependen del filtro.
 */
@QueryHandler(ListAdvanceExpensesQuery)
export class ListAdvanceExpensesHandler implements IQueryHandler<
  ListAdvanceExpensesQuery,
  AdvanceExpenseListView
> {
  constructor(
    private readonly expenses: AdvanceExpenseRepository,
    private readonly contracts: ContractsFacade,
    private readonly views: AdvanceExpenseViews,
  ) {}

  async execute(
    query: ListAdvanceExpensesQuery,
  ): Promise<AdvanceExpenseListView> {
    if (!(await this.contracts.exists(query.contractId))) {
      throw new ExpenseContractNotFoundException(query.contractId)
    }
    const all = await this.expenses.list({ contractId: query.contractId })
    const shown =
      query.settled === undefined
        ? all
        : all.filter((e) => (e.settlementId !== null) === query.settled)
    return this.views.list(shown, all)
  }
}
