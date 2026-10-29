import {
  addDays,
  daysBetween,
  firstDayOfPeriod,
  IsoDate,
  isValidIsoDate,
  isValidPeriod,
  minIsoDate,
  nextPeriod,
  Period,
  periodOf,
} from '@/shared/dates/calendar-date'
import {
  addMoney,
  compareMoney,
  Money,
  percentageOf,
  roundMoney,
  subtractMoney,
  toDecimal,
  toMoneyString,
} from '@/shared/money'
import {
  activeCharges,
  activePayments,
  ChargeConcept,
  Installment,
  InstallmentCharge,
  InstallmentStatus,
  LateFeeAdjustmentKind,
  LateFeeDay,
  Payment,
  PaymentStatus,
  StoredInstallmentStatus,
} from './billing'
import {
  ChargeAlreadyVoidedException,
  ChargeHasAllocationsException,
  InvalidChargeAmountException,
  InvalidInstallmentDateException,
  InvalidInstallmentPeriodException,
  InvalidLateFeeAdjustmentException,
} from './billing.exceptions'

const ZERO = toMoneyString('0')

/** Los saldos de una cuota a una fecha, en la moneda del contrato (regla 2). */
export interface InstallmentBalances {
  asOf: IsoDate
  baseAmount: string
  /** Σ cargos vigentes. */
  chargesTotal: string
  rentPaid: string
  chargesPaid: string
  lateFeePaid: string
  /** Σ imputado por los pagos vigentes (punitorio + alquiler + cargos). */
  paidTotal: string
  /** Lo mismo, sólo de los pagos informados sin confirmar (A-11). */
  pendingConfirmationTotal: string
  feeDays: number
  lateFeeAccrued: string
  /** Σ ajustes REDUCE. */
  lateFeeAdjusted: string
  lateFeeWaived: boolean
  rentBalance: string
  chargesBalance: string
  lateFeeBalance: string
  totalDue: string
  days: LateFeeDay[]
}

/** Lo imputado a cargos de un pago, abierto por concepto (Fase 12, A-16). */
export interface ChargesByConcept {
  SERVICE: string
  TERMINATION_PENALTY: string
  OTHER: string
}

/** Lo que la cuota devenga de honorarios (regla 9, A-12). */
export interface FeeAccrual {
  feeOnBase: string
  feeOnCollected: string
}

function sum(values: string[]): string {
  return toMoneyString(addMoney(ZERO, ...values))
}

function nonNegative(value: string): string {
  return compareMoney(value, ZERO) < 0 ? ZERO : toMoneyString(value)
}

/** Reglas de negocio de las cuotas y los punitorios. Puras: sin NestJS ni Prisma. */
export const InstallmentPolicy = {
  normalizePeriod(value: string): Period {
    const trimmed = value.trim()
    if (!isValidPeriod(trimmed)) throw new InvalidInstallmentPeriodException()
    return trimmed
  },

  /**
   * Sin período, se generan las cuotas del mes que viene: la inmobiliaria
   * las genera el día `installmentGenerationDay` para el mes siguiente.
   */
  defaultPeriod(today: IsoDate): Period {
    return nextPeriod(periodOf(today))
  },

  /** Una fecha del calendario para consultar el desglose (`asOf`). */
  normalizeAsOf(value: string | undefined, today: IsoDate): IsoDate {
    if (value === undefined) return today
    const trimmed = value.trim()
    if (!isValidIsoDate(trimmed)) {
      throw new InvalidInstallmentDateException(
        'asOf',
        'no es una fecha (AAAA-MM-DD)',
      )
    }
    return trimmed
  },

  /**
   * La base de la cuota: el alquiler vigente al generar (D-72). Mes entero
   * aunque el contrato empiece o termine a mitad de mes (A-7); si Micaela
   * pide prorrateo, se cambia acá y en ningún otro lado.
   */
  baseFor(currentRent: string): string {
    return toMoneyString(currentRent)
  },

  /** Último día sin punitorio: primer día del mes + gracia − 1 (RN-02). */
  graceEndDate(period: Period, graceDays: number): IsoDate {
    return addDays(firstDayOfPeriod(period), graceDays - 1)
  },

  /**
   * El alquiler impago al empezar el día `day`: la base menos lo imputado a
   * alquiler por los pagos vigentes con fecha anterior. El día del pago
   * cuenta con el saldo previo (ejemplo de Micaela: gracia 10, pago el 15 →
   * días 11 a 15).
   */
  outstandingRentOn(installment: Installment, day: IsoDate): string {
    const paidBefore = activePayments(installment)
      .filter((p) => p.paidAt < day)
      .map((p) => p.rentApplied)
    return nonNegative(
      subtractMoney(installment.baseAmount, sum(paidBefore)).toString(),
    )
  },

  /**
   * Detalle diario del punitorio (regla 3, A-3, A-4): interés simple sobre
   * el alquiler impago de cada día, desde el día siguiente a la gracia hasta
   * `min(asOf, paidAt)`, cada día redondeado a centavos. Los cargos no
   * devengan (A-10). Condonado (WAIVE), no hay días. Los pagos informados
   * cuentan como pagados a su fecha (A-11).
   */
  lateFeeDays(installment: Installment, asOf: IsoDate): LateFeeDay[] {
    if (installment.lateFeeWaived) return []
    const until = installment.paidAt
      ? minIsoDate(asOf, installment.paidAt)
      : asOf
    const firstFeeDay = addDays(installment.graceEndDate, 1)
    const count = daysBetween(firstFeeDay, until) + 1
    if (count <= 0) return []
    const percentage = toMoneyString(installment.lateFeePercentage)
    const days: LateFeeDay[] = []
    for (let index = 0; index < count; index += 1) {
      const day = addDays(firstFeeDay, index)
      const outstanding = this.outstandingRentOn(installment, day)
      if (compareMoney(outstanding, ZERO) <= 0) break
      days.push({
        day,
        dayNumber: index + 1,
        outstandingBase: outstanding,
        dailyPercentage: percentage,
        amount: toMoneyString(percentageOf(outstanding, percentage)),
      })
    }
    return days
  },

  /** Saldos y punitorio a una fecha (regla 2). */
  balances(installment: Installment, asOf: IsoDate): InstallmentBalances {
    const payments = activePayments(installment)
    const charges = activeCharges(installment)
    const days = this.lateFeeDays(installment, asOf)

    const baseAmount = toMoneyString(installment.baseAmount)
    const chargesTotal = sum(charges.map((c) => c.amount))
    const rentPaid = sum(payments.map((p) => p.rentApplied))
    const chargesPaid = sum(payments.map((p) => p.chargesApplied))
    const lateFeePaid = sum(payments.map((p) => p.lateFeeApplied))
    const lateFeeAccrued = sum(days.map((d) => d.amount))
    const lateFeeAdjusted = sum(
      installment.adjustments
        .filter((a) => a.kind === LateFeeAdjustmentKind.REDUCE)
        .map((a) => a.amount),
    )
    const applied = (p: Payment) =>
      sum([p.lateFeeApplied, p.rentApplied, p.chargesApplied])

    const rentBalance = nonNegative(
      subtractMoney(baseAmount, rentPaid).toString(),
    )
    const chargesBalance = nonNegative(
      subtractMoney(chargesTotal, chargesPaid).toString(),
    )
    const lateFeeBalance = installment.lateFeeWaived
      ? ZERO
      : nonNegative(
          subtractMoney(
            subtractMoney(lateFeeAccrued, lateFeeAdjusted),
            lateFeePaid,
          ).toString(),
        )

    return {
      asOf,
      baseAmount,
      chargesTotal,
      rentPaid,
      chargesPaid,
      lateFeePaid,
      paidTotal: sum(payments.map(applied)),
      pendingConfirmationTotal: sum(
        payments
          .filter((p) => p.status === PaymentStatus.PENDING_CONFIRMATION)
          .map(applied),
      ),
      feeDays: days.length,
      lateFeeAccrued,
      lateFeeAdjusted,
      lateFeeWaived: installment.lateFeeWaived,
      rentBalance,
      chargesBalance,
      lateFeeBalance,
      totalDue: sum([rentBalance, chargesBalance, lateFeeBalance]),
      days,
    }
  },

  /**
   * El día en que el alquiler quedó saldado: la fecha del pago vigente que
   * completó la base, recorriéndolos en orden de fecha. Null si falta.
   */
  paidAtOf(installment: Installment): IsoDate | null {
    const ordered = [...activePayments(installment)].sort(
      (a, b) =>
        a.paidAt.localeCompare(b.paidAt) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )
    let paid = toDecimal(ZERO)
    for (const payment of ordered) {
      paid = paid.plus(toDecimal(payment.rentApplied))
      if (paid.greaterThanOrEqualTo(toDecimal(installment.baseAmount))) {
        return payment.paidAt
      }
    }
    return null
  },

  /**
   * El estado que se guarda (regla 6): PAID sin saldo alguno, PARTIAL con
   * algún pago vigente y saldo, PENDING sin pagos.
   */
  storedStatus(
    installment: Installment,
    balances: InstallmentBalances,
  ): StoredInstallmentStatus {
    if (compareMoney(balances.totalDue, ZERO) === 0) {
      return InstallmentStatus.PAID
    }
    return activePayments(installment).length > 0
      ? InstallmentStatus.PARTIAL
      : InstallmentStatus.PENDING
  },

  /** El que se muestra (D-71): `OVERDUE` si queda saldo y pasó la gracia. */
  displayStatus(
    installment: Pick<Installment, 'status' | 'graceEndDate'>,
    balances: Pick<InstallmentBalances, 'totalDue'>,
    today: IsoDate,
  ): InstallmentStatus {
    if (installment.status === InstallmentStatus.PAID) {
      return InstallmentStatus.PAID
    }
    if (
      compareMoney(balances.totalDue, ZERO) > 0 &&
      today > installment.graceEndDate
    ) {
      return InstallmentStatus.OVERDUE
    }
    return installment.status
  },

  /** Días de atraso de una cuota con saldo: desde el fin de la gracia. */
  daysOverdue(
    installment: Pick<Installment, 'graceEndDate'>,
    today: IsoDate,
  ): number {
    return Math.max(0, daysBetween(installment.graceEndDate, today))
  },

  /**
   * Honorarios devengados (regla 9, A-12): sobre la base y sobre el alquiler
   * efectivamente cobrado (pagos confirmados). Con importe fijo, el fijo
   * entero en cuanto se cobró algo de alquiler.
   */
  feeAccrual(installment: Installment): FeeAccrual {
    const collectedRent = sum(
      installment.payments
        .filter((p) => p.status === PaymentStatus.CONFIRMED)
        .map((p) => p.rentApplied),
    )
    if (installment.feeAmount !== null) {
      const fixed = toMoneyString(installment.feeAmount)
      return {
        feeOnBase: fixed,
        feeOnCollected: compareMoney(collectedRent, ZERO) > 0 ? fixed : ZERO,
      }
    }
    return {
      feeOnBase: toMoneyString(
        percentageOf(installment.baseAmount, installment.feePercentage),
      ),
      feeOnCollected: toMoneyString(
        percentageOf(collectedRent, installment.feePercentage),
      ),
    }
  },

  /**
   * Abre `chargesApplied` de cada pago por concepto de cargo (Fase 12,
   * A-16: los cargos SERVICE no van al neto del propietario). El pago no
   * guarda a qué cargo fue cada peso: se reconstruye imputando los pagos
   * vigentes, en orden de fecha, a los cargos vigentes en orden de alta.
   * Lo que no alcanza a ningún cargo (un cargo anulado después de cobrado)
   * cae en OTHER. Determinista: dos lecturas dan lo mismo.
   */
  chargesAppliedByConcept(
    installment: Pick<Installment, 'charges' | 'payments'>,
  ): Map<string, ChargesByConcept> {
    const remaining = activeCharges(installment)
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((charge) => ({
        concept: charge.concept,
        left: toDecimal(charge.amount),
      }))
    const ordered = [...activePayments(installment)].sort(
      (a, b) =>
        a.paidAt.localeCompare(b.paidAt) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    const result = new Map<string, ChargesByConcept>()
    for (const payment of ordered) {
      const split: Record<ChargeConcept, Money> = {
        SERVICE: toDecimal(ZERO),
        TERMINATION_PENALTY: toDecimal(ZERO),
        OTHER: toDecimal(ZERO),
      }
      let pending = toDecimal(payment.chargesApplied)
      for (const charge of remaining) {
        if (pending.lessThanOrEqualTo(0)) break
        if (charge.left.lessThanOrEqualTo(0)) continue
        const portion = pending.lessThan(charge.left) ? pending : charge.left
        split[charge.concept] = split[charge.concept].plus(portion)
        charge.left = charge.left.minus(portion)
        pending = pending.minus(portion)
      }
      if (pending.greaterThan(0)) split.OTHER = split.OTHER.plus(pending)
      result.set(payment.id, {
        SERVICE: toMoneyString(split.SERVICE),
        TERMINATION_PENALTY: toMoneyString(split.TERMINATION_PENALTY),
        OTHER: toMoneyString(split.OTHER),
      })
    }
    return result
  },

  // ------------------------------------------------------------- Cargos

  normalizeChargeAmount(value: string): string {
    let amount
    try {
      amount = roundMoney(value)
    } catch {
      throw new InvalidChargeAmountException()
    }
    if (amount.lessThanOrEqualTo(0)) throw new InvalidChargeAmountException()
    return toMoneyString(amount)
  },

  normalizeDescription(value: string): string {
    const trimmed = value.trim().replace(/\s+/g, ' ')
    if (trimmed.length === 0) {
      throw new InvalidChargeAmountException('describí el cargo')
    }
    return trimmed.slice(0, 300)
  },

  /**
   * Un cargo se anula sólo si nada se le imputó (3.2): lo imputado a cargos
   * no puede superar lo que queda de cargos vigentes sin él.
   */
  assertChargeVoidable(
    charge: InstallmentCharge,
    balances: InstallmentBalances,
  ): void {
    if (charge.voidedAt !== null) {
      throw new ChargeAlreadyVoidedException(charge.id)
    }
    const remainingCharges = subtractMoney(balances.chargesTotal, charge.amount)
    if (compareMoney(balances.chargesPaid, remainingCharges) > 0) {
      throw new ChargeHasAllocationsException(charge.id)
    }
  },

  // --------------------------------------------------------- Punitorios

  /**
   * Ajuste del punitorio (3.5, Micaela #4). `REDUCE` descuenta un monto
   * (> 0, hasta el saldo de punitorio); `WAIVE` condona todo: el monto que
   * se registra es el devengado al momento, informativo.
   */
  lateFeeAdjustment(
    installment: Installment,
    balances: InstallmentBalances,
    kind: LateFeeAdjustmentKind,
    amount: string | null,
  ): { amount: string; waive: boolean } {
    if (installment.lateFeeWaived) {
      throw new InvalidLateFeeAdjustmentException(
        'el punitorio de esta cuota ya está condonado',
      )
    }
    if (kind === LateFeeAdjustmentKind.WAIVE) {
      return { amount: balances.lateFeeAccrued, waive: true }
    }
    if (amount === null) {
      throw new InvalidLateFeeAdjustmentException(
        'para reducir hay que indicar el monto',
      )
    }
    let reduce
    try {
      reduce = roundMoney(amount)
    } catch {
      throw new InvalidLateFeeAdjustmentException('el monto no es un número')
    }
    if (reduce.lessThanOrEqualTo(0)) {
      throw new InvalidLateFeeAdjustmentException(
        'el monto tiene que ser mayor que cero',
      )
    }
    if (reduce.greaterThan(toDecimal(balances.lateFeeBalance))) {
      throw new InvalidLateFeeAdjustmentException(
        `el monto supera el punitorio pendiente (${balances.lateFeeBalance})`,
      )
    }
    return { amount: toMoneyString(reduce), waive: false }
  },

  normalizeReason(value: string): string {
    const trimmed = value.trim().replace(/\s+/g, ' ')
    if (trimmed.length === 0) {
      throw new InvalidLateFeeAdjustmentException('hay que indicar el motivo')
    }
    return trimmed.slice(0, 500)
  },

  normalizeNotes(value: string | null | undefined): string | null {
    const trimmed = value?.trim().replace(/\s+/g, ' ') ?? ''
    return trimmed.length > 0 ? trimmed : null
  },
}
