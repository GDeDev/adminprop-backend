import { UserRef } from '@/modules/auth/public'
import { IsoDate } from '@/shared/dates/calendar-date'
import {
  Currency,
  DepositDeductionConcept,
  DepositReturn,
  PaymentMethod,
} from '../domain/billing'

export interface DepositReturnDeductionView {
  id: string
  concept: DepositDeductionConcept
  description: string
  amount: string
  installmentId: string | null
  paymentId: string | null
}

/** La devolución del depósito, en la cuenta corriente y como respuesta del alta. */
export interface DepositReturnView {
  id: string
  contractId: string
  returnedAt: IsoDate
  depositAmount: string
  depositCurrency: Currency
  returnedAmount: string
  method: PaymentMethod
  notes: string | null
  registeredBy: UserRef | null
  deductions: DepositReturnDeductionView[]
  createdAt: Date
}

export function toDepositReturnView(
  ret: DepositReturn,
  users: Map<string, UserRef>,
): DepositReturnView {
  return {
    id: ret.id,
    contractId: ret.contractId,
    returnedAt: ret.returnedAt,
    depositAmount: ret.depositAmount,
    depositCurrency: ret.depositCurrency,
    returnedAmount: ret.returnedAmount,
    method: ret.method,
    notes: ret.notes,
    registeredBy: users.get(ret.registeredById) ?? null,
    deductions: ret.deductions.map((d) => ({
      id: d.id,
      concept: d.concept,
      description: d.description,
      amount: d.amount,
      installmentId: d.installmentId,
      paymentId: d.paymentId,
    })),
    createdAt: ret.createdAt,
  }
}
