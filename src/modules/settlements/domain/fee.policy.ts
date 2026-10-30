import { IsoDate } from '@/shared/dates/calendar-date'
import {
  addMoney,
  compareMoney,
  percentageOf,
  roundMoney,
  subtractMoney,
  toDecimal,
  toMoneyString,
} from '@/shared/money'
import {
  Currency,
  FeeMode,
  FeePayer,
  FeePayment,
  FeeReceivable,
  FeeReceivableStatus,
  FeeTerms,
  OwnerFeeRules,
} from './settlement'
import { InvalidFeePaymentAmountException } from './settlement.exceptions'

const ZERO = toMoneyString('0')

function sum(values: string[]): string {
  return toMoneyString(addMoney(ZERO, ...values))
}

/** Lo cobrado de una cuota que puede entrar en la base del honorario. */
export interface CollectedForFee {
  rentApplied: string
  lateFeeApplied: string
  ownerChargesApplied: string
}

export interface FeeComputation {
  /** Lo que se tomó como base (alquiler, más lo que el propietario incluya). */
  base: string
  amount: string
}

export interface FeeAllocation {
  receivableId: string
  amount: string
}

export interface FeeAllocationResult {
  allocations: FeeAllocation[]
  /** Lo que no alcanzó a imputarse a ningún receivable. */
  unallocated: string
}

export interface FeeAccountTotals {
  currency: Currency
  /** Σ receivables vigentes (no anulados). */
  accrued: string
  /** Σ cobrado e imputado. */
  collected: string
  /** `accrued − collected`. */
  pending: string
  /** Σ sin imputar de los pagos vigentes. */
  unallocated: string
}

export enum FeeMovementType {
  ACCRUED = 'ACCRUED',
  PAYMENT = 'PAYMENT',
  PAYMENT_VOIDED = 'PAYMENT_VOIDED',
  RECEIVABLE_VOIDED = 'RECEIVABLE_VOIDED',
}

export interface FeeMovement {
  date: IsoDate
  type: FeeMovementType
  description: string
  /** Lo que el propietario pasa a deber. */
  debit: string | null
  /** Lo que pagó. */
  credit: string | null
  /** Saldo acumulado por moneda (deuda positiva). */
  balance: string
  currency: Currency
}

/** Reglas de los honorarios (4.2, 4.8; Micaela #5 y #10). Puras. */
export const FeePolicy = {
  /**
   * A-15: el honorario fijo por contrato se prorratea por el alquiler
   * cobrado (`fijo × cobrado / base`), con un solo redondeo. Así un pago
   * parcial no cobra el fijo entero y la suma de las liquidaciones de una
   * cuota cobra exactamente el fijo. _Si Micaela lo quiere entero en la
   * primera liquidación_: devolver `feeAmount` cuando `rentApplied > 0`.
   */
  fixedFeeFor(
    feeAmount: string,
    rentApplied: string,
    baseAmount: string,
  ): string {
    if (compareMoney(baseAmount, ZERO) <= 0) return ZERO
    return toMoneyString(
      toDecimal(feeAmount)
        .times(toDecimal(rentApplied))
        .dividedBy(toDecimal(baseAmount)),
    )
  },

  /**
   * Honorario de una cuota (4.2): la base es el alquiler cobrado, más los
   * punitorios y los cargos del propietario si él los incluye (Micaela #5);
   * nunca los cargos SERVICE (A-16). Con fijo, se prorratea (A-15); con %,
   * `base × % / 100`. Un solo redondeo por cuota.
   */
  feeForInstallment(
    terms: FeeTerms,
    collected: CollectedForFee,
    rules: OwnerFeeRules,
  ): FeeComputation {
    const base = sum([
      collected.rentApplied,
      rules.feeIncludesLateFees ? collected.lateFeeApplied : ZERO,
      rules.feeIncludesCharges ? collected.ownerChargesApplied : ZERO,
    ])
    if (terms.feeAmount !== null) {
      return {
        base,
        amount: this.fixedFeeFor(
          terms.feeAmount,
          collected.rentApplied,
          terms.baseAmount,
        ),
      }
    }
    return {
      base,
      amount: toMoneyString(percentageOf(base, terms.feePercentage)),
    }
  },

  /** Quién paga el honorario según la modalidad (3.3). */
  payerFor(feeMode: FeeMode): FeePayer {
    return feeMode === FeeMode.RENTER_PAYS_ON_BEHALF
      ? FeePayer.RENTER
      : FeePayer.OWNER
  },

  /** Sólo `DEDUCTED` se descuenta del neto; el resto nace como honorario a cobrar. */
  isDeducted(feeMode: FeeMode): boolean {
    return feeMode === FeeMode.DEDUCTED
  },

  normalizeAmount(value: string): string {
    let amount
    try {
      amount = roundMoney(value)
    } catch {
      throw new InvalidFeePaymentAmountException()
    }
    if (amount.lessThanOrEqualTo(0))
      throw new InvalidFeePaymentAmountException()
    return toMoneyString(amount)
  },

  /** Lo que le falta cobrar a un receivable; 0 si está anulado. */
  remainingOf(receivable: FeeReceivable): string {
    if (receivable.status === FeeReceivableStatus.VOIDED) return ZERO
    const left = subtractMoney(receivable.amount, receivable.paidAmount)
    return left.isNegative() ? ZERO : toMoneyString(left)
  },

  /**
   * Imputación de un pago de honorarios (3.3): a los receivables pendientes
   * más viejos primero (el orden lo da quien llama), cada uno hasta lo que
   * le falta; el exceso queda sin imputar para receivables futuros.
   */
  allocate(amount: string, receivables: FeeReceivable[]): FeeAllocationResult {
    let remaining = toDecimal(amount)
    const allocations: FeeAllocation[] = []
    for (const receivable of receivables) {
      if (remaining.lessThanOrEqualTo(0)) break
      const left = toDecimal(this.remainingOf(receivable))
      if (left.lessThanOrEqualTo(0)) continue
      const portion = remaining.lessThan(left) ? remaining : left
      allocations.push({
        receivableId: receivable.id,
        amount: toMoneyString(portion),
      })
      remaining = remaining.minus(portion)
    }
    return { allocations, unallocated: toMoneyString(remaining) }
  },

  /** El estado que se guarda según lo cobrado. */
  receivableStatus(amount: string, paidAmount: string): FeeReceivableStatus {
    if (compareMoney(paidAmount, ZERO) <= 0) return FeeReceivableStatus.PENDING
    return compareMoney(paidAmount, amount) >= 0
      ? FeeReceivableStatus.PAID
      : FeeReceivableStatus.PARTIAL
  },

  /** Totales de la cuenta de honorarios por moneda (4.8). */
  accountTotals(
    receivables: FeeReceivable[],
    payments: FeePayment[],
  ): FeeAccountTotals[] {
    const currencies = [
      ...new Set([
        ...receivables.map((r) => r.currency),
        ...payments.map((p) => p.currency),
      ]),
    ].sort()
    return currencies.map((currency) => {
      const active = receivables.filter(
        (r) =>
          r.currency === currency && r.status !== FeeReceivableStatus.VOIDED,
      )
      const accrued = sum(active.map((r) => r.amount))
      const collected = sum(active.map((r) => r.paidAmount))
      return {
        currency,
        accrued,
        collected,
        pending: toMoneyString(subtractMoney(accrued, collected)),
        unallocated: sum(
          payments
            .filter((p) => p.currency === currency && p.voidedAt === null)
            .map((p) => p.unallocatedAmount),
        ),
      }
    })
  },

  /**
   * Movimientos cronológicos de la cuenta de honorarios con saldo acumulado
   * por moneda: devengado (débito), pago (crédito), pago anulado (débito por
   * lo que había pagado), receivable anulado (crédito por lo devengado).
   */
  movements(
    receivables: FeeReceivable[],
    payments: FeePayment[],
    describe: {
      receivable: (r: FeeReceivable) => string
      payment: (p: FeePayment) => string
    },
  ): FeeMovement[] {
    type Draft = Omit<FeeMovement, 'balance'> & { order: number; stamp: number }
    const drafts: Draft[] = []
    const day = (d: Date) => d.toISOString().slice(0, 10)
    for (const r of receivables) {
      drafts.push({
        date: day(r.createdAt),
        type: FeeMovementType.ACCRUED,
        description: describe.receivable(r),
        debit: r.amount,
        credit: null,
        currency: r.currency,
        order: 0,
        stamp: r.createdAt.getTime(),
      })
      if (r.status === FeeReceivableStatus.VOIDED && r.voidedAt) {
        drafts.push({
          date: day(r.voidedAt),
          type: FeeMovementType.RECEIVABLE_VOIDED,
          description: `Anulado: ${describe.receivable(r)}`,
          debit: null,
          credit: r.amount,
          currency: r.currency,
          order: 3,
          stamp: r.voidedAt.getTime(),
        })
      }
    }
    for (const p of payments) {
      drafts.push({
        date: p.paidAt,
        type: FeeMovementType.PAYMENT,
        description: describe.payment(p),
        debit: null,
        credit: p.amount,
        currency: p.currency,
        order: 1,
        stamp: p.createdAt.getTime(),
      })
      if (p.voidedAt) {
        drafts.push({
          date: day(p.voidedAt),
          type: FeeMovementType.PAYMENT_VOIDED,
          description: `Pago anulado (${p.voidReason ?? ''})`,
          debit: p.amount,
          credit: null,
          currency: p.currency,
          order: 2,
          stamp: p.voidedAt.getTime(),
        })
      }
    }
    // Mismo día: por hora de alta, así dos pagos del mismo día salen en el
    // orden en que se cargaron.
    drafts.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.stamp - b.stamp || a.order - b.order,
    )
    const running = new Map<Currency, string>()
    return drafts.map(({ order: _order, stamp: _stamp, ...draft }) => {
      const previous = running.get(draft.currency) ?? ZERO
      const balance = toMoneyString(
        subtractMoney(
          addMoney(previous, draft.debit ?? ZERO),
          draft.credit ?? ZERO,
        ),
      )
      running.set(draft.currency, balance)
      return { ...draft, balance }
    })
  },
}
