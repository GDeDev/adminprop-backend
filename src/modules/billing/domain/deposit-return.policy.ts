import { IsoDate, isValidIsoDate } from '@/shared/dates/calendar-date'
import {
  addMoney,
  compareMoney,
  roundMoney,
  subtractMoney,
  toMoneyString,
} from '@/shared/money'
import { Currency, DepositDeductionConcept, DepositReturnMode } from './billing'
import {
  DepositDeductionsExceedReferenceException,
  DepositReturnContractActiveException,
  DepositReturnUnbalancedException,
  InvalidDepositDeductionException,
  InvalidDepositReferenceException,
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
  /** Cómo se devuelve (Micaela #1): decide el monto de referencia. */
  depositReturnMode: DepositReturnMode
  /** Moneda y alquiler vigente, para el modo `FOLLOWS_RENT`. */
  currency: Currency
  currentRent: string
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
  assertReturnable(
    contract: Pick<DepositContract, 'id' | 'status' | 'endDate'>,
    today: IsoDate,
  ): void {
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
   * El monto del que se descuentan las deducciones (D-227; Micaela #1). El
   * depósito se registra por lo recibido y no se actualiza solo; lo que se
   * devuelve lo fija el modo del contrato:
   * - `FIXED`: lo recibido.
   * - `FOLLOWS_RENT`: el alquiler vigente al cerrar (el "último mes"). Sólo
   *   se calcula si el contrato y el depósito están en la misma moneda; no
   *   hay cotización en una devolución, así que en otro caso hay que
   *   indicarlo a mano.
   * - `MANUAL`: el que se indique al cerrar las cuentas (obligatorio).
   * Si el cliente manda un valor en un modo automático tiene que coincidir:
   * una diferencia es un error de pantalla desactualizada, no una decisión.
   */
  resolveReference(
    contract: DepositContract,
    provided: string | null,
  ): { mode: DepositReturnMode; referenceAmount: string } {
    const mode = contract.depositReturnMode
    const normalized = provided === null ? null : normalizeReference(provided)
    let computed: string | null = null
    if (mode === DepositReturnMode.FIXED) {
      computed = toMoneyString(roundMoney(contract.deposit))
    } else if (
      mode === DepositReturnMode.FOLLOWS_RENT &&
      contract.currency === contract.depositCurrency
    ) {
      computed = toMoneyString(roundMoney(contract.currentRent))
    }
    if (computed === null) {
      if (normalized === null) {
        throw new InvalidDepositReferenceException(
          mode === DepositReturnMode.MANUAL
            ? 'el contrato define el monto a mano: indicalo'
            : 'el alquiler está en otra moneda que el depósito: indicá el monto',
        )
      }
      return { mode, referenceAmount: normalized }
    }
    if (normalized !== null && compareMoney(normalized, computed) !== 0) {
      throw new InvalidDepositReferenceException(
        `según el contrato corresponde ${computed} y se indicó ${normalized}`,
      )
    }
    return { mode, referenceAmount: computed }
  },

  /**
   * Las deducciones justificadas se descuentan del monto de referencia y lo
   * que queda se devuelve. Si el cliente manda `returnedAmount` tiene que dar
   * lo mismo (400 `DEPOSIT_RETURN_UNBALANCED`); si las deducciones superan la
   * referencia, 400 `DEPOSIT_RETURN_DEDUCTIONS_EXCEED`.
   */
  settle(
    referenceAmount: string,
    deductions: Pick<DeductionInput, 'amount'>[],
    returnedAmount: string | null,
  ): string {
    const totalDeductions = toMoneyString(
      addMoney('0', ...deductions.map((d) => d.amount)),
    )
    if (compareMoney(totalDeductions, referenceAmount) > 0) {
      throw new DepositDeductionsExceedReferenceException(
        toMoneyString(referenceAmount),
        totalDeductions,
      )
    }
    const toReturn = toMoneyString(
      subtractMoney(referenceAmount, totalDeductions),
    )
    if (
      returnedAmount !== null &&
      compareMoney(returnedAmount, toReturn) !== 0
    ) {
      throw new DepositReturnUnbalancedException(
        toMoneyString(referenceAmount),
        toMoneyString(addMoney(returnedAmount, totalDeductions)),
      )
    }
    return toReturn
  },

  /**
   * Las deudas sumadas por cuota (alto 6): dos deducciones sobre la misma
   * cuota se validan juntas contra lo que debe, no cada una por su lado.
   */
  debtsByInstallment(
    deductions: Pick<DeductionInput, 'concept' | 'installmentId' | 'amount'>[],
  ): Map<string, string> {
    const totals = new Map<string, string>()
    for (const d of deductions) {
      if (d.concept !== DepositDeductionConcept.DEBT || !d.installmentId) {
        continue
      }
      totals.set(
        d.installmentId,
        toMoneyString(addMoney(totals.get(d.installmentId) ?? '0', d.amount)),
      )
    }
    return totals
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

function normalizeReference(value: string): string {
  let amount
  try {
    amount = roundMoney(value)
  } catch {
    throw new InvalidDepositReferenceException('no es un número')
  }
  if (amount.lessThanOrEqualTo(0)) {
    throw new InvalidDepositReferenceException('tiene que ser mayor que cero')
  }
  return toMoneyString(amount)
}
