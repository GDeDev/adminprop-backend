import { IsoDate } from '@/shared/dates/calendar-date'
import { AdvanceExpense } from './advance-expense'
import {
  Currency,
  IncreaseFrequency,
  PropertyService,
  ServicePayer,
} from './property-service'

export interface NewPropertyService {
  propertyId: string
  contractId: string | null
  serviceTypeId: string
  paidBy: ServicePayer
  currency: Currency
  hasDueDate: boolean
  dueDate: IsoDate | null
  hasIncrease: boolean
  increaseFrequency: IncreaseFrequency | null
  managedByAgency: boolean
  notes: string | null
}

/** Todo es editable salvo la propiedad: un servicio no se muda de propiedad. */
export type PropertyServiceChanges = Partial<
  Omit<NewPropertyService, 'propertyId'>
>

export interface PageArgs {
  skip: number
  take: number
}

/**
 * Puerto del repositorio de servicios. Todo corre dentro del tenant del
 * contexto; el borrado es lógico (lo hace la extensión de Prisma).
 */
export abstract class PropertyServiceRepository {
  abstract create(data: NewPropertyService): Promise<PropertyService>

  abstract findById(id: string): Promise<PropertyService | null>

  /** Los de la propiedad, opcionalmente sólo los de un contrato. Por alta. */
  abstract listByProperty(
    propertyId: string,
    contractId?: string,
  ): Promise<PropertyService[]>

  /**
   * Los que aplican a un contrato: los suyos más los de la propiedad sin
   * contrato (D-66).
   */
  abstract listForContract(
    propertyId: string,
    contractId: string,
  ): Promise<PropertyService[]>

  /** Vencidos a esa fecha, los más atrasados primero. */
  abstract listOverdue(
    today: IsoDate,
    filter: { propertyId?: string },
    page?: PageArgs,
  ): Promise<[PropertyService[], number]>

  abstract countByProperty(propertyId: string): Promise<number>

  abstract update(
    id: string,
    changes: PropertyServiceChanges,
  ): Promise<PropertyService>

  abstract delete(id: string): Promise<void>
}

export interface NewAdvanceExpense {
  contractId: string
  renterId: string
  amount: string
  currency: Currency
  description: string
  expenseDate: IsoDate
  receiptKey: string
  receiptUrl: string
  registeredById: string
}

/** Lo editable mientras el gasto está pendiente. */
export interface AdvanceExpenseChanges {
  amount?: string
  description?: string
  expenseDate?: IsoDate
}

export interface AdvanceExpenseFilter {
  contractId: string
  /** Sólo descontados (`true`) o sólo pendientes (`false`). */
  settled?: boolean
}

/** Puerto del repositorio de gastos adelantados. Dentro del tenant del contexto. */
export abstract class AdvanceExpenseRepository {
  abstract create(data: NewAdvanceExpense): Promise<AdvanceExpense>

  abstract findById(id: string): Promise<AdvanceExpense | null>

  /** Del más reciente al más viejo por fecha del gasto. */
  abstract list(filter: AdvanceExpenseFilter): Promise<AdvanceExpense[]>

  abstract update(
    id: string,
    changes: AdvanceExpenseChanges,
  ): Promise<AdvanceExpense>

  /** Marca los pendientes de la lista como descontados. Devuelve cuántos. */
  abstract markSettled(
    ids: string[],
    settlementId: string,
    settledAt: Date,
  ): Promise<number>

  abstract delete(id: string): Promise<void>
}
