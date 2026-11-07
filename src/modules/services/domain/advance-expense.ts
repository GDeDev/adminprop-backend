import { IsoDate } from '@/shared/dates/calendar-date'
import { Currency } from './property-service'

/**
 * Gasto que el inquilino adelantó y se le descuenta al propietario en la
 * liquidación (RN-11). Monto como string decimal. Con `settlementId` la fila
 * es inmutable (spec 4).
 */
export interface AdvanceExpense {
  id: string
  contractId: string
  /** Copiado del contrato al registrarlo. */
  renterId: string
  amount: string
  currency: Currency
  description: string
  expenseDate: IsoDate
  receiptKey: string
  receiptUrl: string
  /** Liquidación que lo descontó (Fase 12). Null = pendiente. */
  settlementId: string | null
  settledAt: Date | null
  registeredById: string
  createdAt: Date
  updatedAt: Date
}

/** Descontado en una liquidación o todavía pendiente. */
export function isSettled(expense: Pick<AdvanceExpense, 'settlementId'>) {
  return expense.settlementId !== null
}
