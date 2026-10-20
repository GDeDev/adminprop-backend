import { Injectable } from '@nestjs/common'

import { UserRef, UsersFacade } from '@/modules/auth/public'
import { IsoDate } from '@/shared/dates/calendar-date'
import { addMoney, toMoneyString } from '@/shared/money'
import { AdvanceExpense, isSettled } from '../domain/advance-expense'
import { Currency } from '../domain/property-service'

/** Un gasto adelantado tal como lo ve el cliente. Monto como string decimal. */
export interface AdvanceExpenseView {
  id: string
  contractId: string
  renterId: string
  amount: string
  currency: Currency
  description: string
  expenseDate: IsoDate
  receiptUrl: string
  /** Descontado en una liquidación (`settlementId` cargado). */
  settled: boolean
  settlementId: string | null
  settledAt: Date | null
  /** Null si el usuario se borró. */
  registeredBy: UserRef | null
  createdAt: Date
}

/** El listado de un contrato con sus totales (spec 6, último criterio). */
export interface AdvanceExpenseListView {
  items: AdvanceExpenseView[]
  /** Suma de los pendientes del contrato, sin importar el filtro. */
  pendingTotal: string
  /** Suma de los ya descontados del contrato, sin importar el filtro. */
  settledTotal: string
}

@Injectable()
export class AdvanceExpenseViews {
  constructor(private readonly users: UsersFacade) {}

  async one(expense: AdvanceExpense): Promise<AdvanceExpenseView> {
    const [view] = await this.many([expense])
    return view
  }

  async many(expenses: AdvanceExpense[]): Promise<AdvanceExpenseView[]> {
    if (expenses.length === 0) return []
    const users = await this.users.describe(
      expenses.map((e) => e.registeredById),
    )
    return expenses.map((expense) => ({
      id: expense.id,
      contractId: expense.contractId,
      renterId: expense.renterId,
      amount: expense.amount,
      currency: expense.currency,
      description: expense.description,
      expenseDate: expense.expenseDate,
      receiptUrl: expense.receiptUrl,
      settled: isSettled(expense),
      settlementId: expense.settlementId,
      settledAt: expense.settledAt,
      registeredBy: users.get(expense.registeredById) ?? null,
      createdAt: expense.createdAt,
    }))
  }

  /**
   * `all` son todos los gastos del contrato (para los totales); `shown`,
   * los que pasan el filtro.
   */
  async list(
    shown: AdvanceExpense[],
    all: AdvanceExpense[],
  ): Promise<AdvanceExpenseListView> {
    return {
      items: await this.many(shown),
      pendingTotal: sumOf(all.filter((e) => !isSettled(e))),
      settledTotal: sumOf(all.filter((e) => isSettled(e))),
    }
  }
}

/**
 * Suma sin mirar la moneda: un contrato tiene una sola, y los gastos la
 * copian al crearse (D-67).
 */
export function sumOf(expenses: Pick<AdvanceExpense, 'amount'>[]): string {
  return toMoneyString(addMoney(...expenses.map((e) => e.amount)))
}
