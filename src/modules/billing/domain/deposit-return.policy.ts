import { IsoDate, isValidIsoDate } from '@/shared/dates/calendar-date'
import {
  addMoney,
  compareMoney,
  roundMoney,
  toMoneyString,
} from '@/shared/money'
import { Currency, DepositDeductionConcept } from './billing'
import {
  DepositReturnContractActiveException,
  DepositReturnUnbalancedException,
  InvalidDepositDeductionException,
  InvalidDepositReturnDateException,
} from './billing.exceptions'

/** Lo que el dominio necesita saber del contrato para devolver el depósito. */
export interface DepositContract {
  id: string
  /** `ACTIVE | FINISHED | TERMINATED`, como lo expone la facade de contratos. */
  status: string
  endDate: IsoDate
  deposit: string
  depositCurrency: Currency
}

export interface DeductionInput {
  concept: DepositDeductionConcept
  description: string
  amount: string
  installmentId: string | null
}

/**
 * Reglas de la devolución del depósito (Fase 12, 2.2; Micaela #1; A-13
 * cerrado). Puras: sin NestJS ni Prisma.
 */
export const DepositReturnPolicy = {
  /**
   * Sólo se devuelve al cerrar las cuentas: contrato finalizado, rescindido
   * o activo con el fin ya pasado (el cron de la Fase 13 todavía no lo
   * finalizó). Un contrato vigente → 409.
   */
  assertReturnable(contract: DepositContract, today: IsoDate): void {
    if (contract.status === 'ACTIVE' && contract.endDate >= today) {
      throw new DepositReturnContractActiveException(contract.id)
    }
  },

  normalizeReturnedAt(value: string, today: IsoDate): IsoDate {
    const trimmed = value.trim()
    if (!isValidIsoDate(trimmed)) {
      throw new InvalidDepositReturnDateException(
        'no es una fecha (AAAA-MM-DD)',
      )
    }
    if (trimmed > today) {
      throw new InvalidDepositReturnDateException('no puede ser futura')
    }
    return trimmed
  },

  /** Lo devuelto puede ser 0 (todo descontado), nunca negativo. */
  normalizeReturnedAmount(value: string): string {
    let amount
    try {
      amount = roundMoney(value)
    } catch {
      throw new InvalidDepositDeductionException(
        'el monto devuelto no es un número',
      )
    }
    if (amount.isNegative()) {
      throw new InvalidDepositDeductionException(
        'el monto devuelto no puede ser negativo',
      )
    }
    return toMoneyString(amount)
  },

  /** Cada deducción: monto > 0, descripción, y cuota sólo en `DEBT`. */
  normalizeDeductions(deductions: DeductionInput[]): DeductionInput[] {
    return deductions.map((deduction) => {
      let amount
      try {
        amount = roundMoney(deduction.amount)
      } catch {
        throw new InvalidDepositDeductionException('el monto no es un número')
      }
      if (amount.lessThanOrEqualTo(0)) {
        throw new InvalidDepositDeductionException(
          'el monto tiene que ser mayor que cero',
        )
      }
      const description = deduction.description.trim().replace(/\s+/g, ' ')
      if (description.length === 0) {
        throw new InvalidDepositDeductionException('describí la deducción')
      }
      if (
        deduction.installmentId !== null &&
        deduction.concept !== DepositDeductionConcept.DEBT
      ) {
        throw new InvalidDepositDeductionException(
          'sólo una deducción por deuda (DEBT) se imputa a una cuota',
        )
      }
      return {
        concept: deduction.concept,
        description: description.slice(0, 300),
        amount: toMoneyString(amount),
        installmentId: deduction.installmentId,
      }
    })
  },

  /**
   * Invariante: `returnedAmount + Σ deducciones = depositAmount` (400
   * `DEPOSIT_RETURN_UNBALANCED` si no cierra). Así lo que se le devuelve al
   * inquilino y lo que se le descuenta siempre explican el depósito entero.
   */
  assertBalanced(
    depositAmount: string,
    returnedAmount: string,
    deductions: Pick<DeductionInput, 'amount'>[],
  ): void {
    const accounted = toMoneyString(
      addMoney(returnedAmount, ...deductions.map((d) => d.amount)),
    )
    if (compareMoney(accounted, depositAmount) !== 0) {
      throw new DepositReturnUnbalancedException(
        toMoneyString(depositAmount),
        accounted,
      )
    }
  },

  /**
   * Una deuda imputada a una cuota se cobra con el depósito: la moneda tiene
   * que coincidir (no hay cotización en una devolución) y el monto no puede
   * superar lo que la cuota debe a esa fecha.
   */
  assertDebtFitsInstallment(
    deduction: Pick<DeductionInput, 'amount'>,
    installment: { contractId: string; currency: Currency; totalDue: string },
    contract: Pick<DepositContract, 'id' | 'depositCurrency'>,
  ): void {
    if (installment.contractId !== contract.id) {
      throw new InvalidDepositDeductionException(
        'la cuota no es de este contrato',
      )
    }
    if (installment.currency !== contract.depositCurrency) {
      throw new InvalidDepositDeductionException(
        'la cuota está en otra moneda que el depósito',
      )
    }
    if (compareMoney(deduction.amount, installment.totalDue) > 0) {
      throw new InvalidDepositDeductionException(
        `el monto supera lo que debe la cuota (${installment.totalDue})`,
      )
    }
  },
}
