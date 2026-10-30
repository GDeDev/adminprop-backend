import {
  IsoDate,
  isValidIsoDate,
  isValidPeriod,
  Period,
  periodOf,
} from '@/shared/dates/calendar-date'
import { detectFileKind, FileKind } from '@/shared/files/file-signature'
import {
  addMoney,
  compareMoney,
  roundMoney,
  subtractMoney,
  toDecimal,
  toMoneyString,
} from '@/shared/money'
import { FeePolicy } from './fee.policy'
import {
  activeAdjustments,
  activeTransfers,
  CollectedPayment,
  Currency,
  FeeMode,
  isConfirmed,
  OwnerFeeRules,
  OwnerStatementTotals,
  PendingExpense,
  Settlement,
  SettlementAdjustment,
  SettlementAdjustmentConcept,
  SettlementStatus,
  SettlementTotals,
} from './settlement'
import {
  InvalidSettlementAmountException,
  InvalidSettlementDateException,
  InvalidSettlementPeriodException,
  InvalidSettlementReceiptException,
  InvalidSettlementTextException,
  SettlementNotConfirmedException,
  SettlementNotPendingException,
  SettlementTransferExceedsNetException,
} from './settlement.exceptions'

/** 10 MB, como los comprobantes de pagos y gastos. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024

const ZERO = toMoneyString('0')

function sum(values: string[]): string {
  return toMoneyString(addMoney(ZERO, ...values))
}

/** Lo que se calcula al crear o recalcular: líneas y totales sin los ajustes. */
export interface SettlementComputation extends Omit<
  SettlementTotals,
  'adjustmentsTotal' | 'netAmount'
> {
  payments: CollectedPayment[]
  expenses: PendingExpense[]
  /** Gastos en otra moneda que el contrato: se avisan, no se descuentan. */
  skippedExpenses: PendingExpense[]
}

/** Reglas de la liquidación (sección 4). Puras: sin NestJS ni Prisma. */
export const SettlementPolicy = {
  /** Mes de la liquidación: el que venga, o el de hoy (A-21). */
  normalizePeriod(value: string | null | undefined, today: IsoDate): Period {
    if (value === null || value === undefined || value.trim() === '') {
      return periodOf(today)
    }
    const trimmed = value.trim()
    if (!isValidPeriod(trimmed)) throw new InvalidSettlementPeriodException()
    return trimmed
  },

  /**
   * Arma las líneas y los totales (4.1, 4.2): suma lo cobrado por concepto,
   * calcula el honorario cuota por cuota con los términos congelados de
   * cada una (`FeePolicy.feeForInstallment`) y toma los gastos pendientes en
   * la moneda del contrato. El `feeMode` que se guarda es el de la cuota
   * más reciente; `mixedFeeTerms` avisa si las cuotas difieren.
   */
  compute(
    payments: CollectedPayment[],
    expenses: PendingExpense[],
    currency: Currency,
    rules: OwnerFeeRules,
    fallbackTerms: { feeMode: FeeMode; feePercentage: string },
  ): SettlementComputation {
    const byInstallment = new Map<string, CollectedPayment[]>()
    for (const payment of payments) {
      byInstallment.set(payment.installmentId, [
        ...(byInstallment.get(payment.installmentId) ?? []),
        payment,
      ])
    }
    const fees = [...byInstallment.values()].map((group) => {
      const terms = group[0].terms
      const computed = FeePolicy.feeForInstallment(
        terms,
        {
          rentApplied: sum(group.map((p) => p.rentApplied)),
          lateFeeApplied: sum(group.map((p) => p.lateFeeApplied)),
          ownerChargesApplied: sum(group.map((p) => p.ownerChargesApplied)),
        },
        rules,
      )
      return { period: group[0].installmentPeriod, terms, ...computed }
    })
    const latest = [...fees].sort((a, b) => b.period.localeCompare(a.period))[0]
    const sameTerms = (a: typeof latest, b: typeof latest) =>
      a.terms.feeMode === b.terms.feeMode &&
      compareMoney(a.terms.feePercentage, b.terms.feePercentage) === 0 &&
      (a.terms.feeAmount === null) === (b.terms.feeAmount === null) &&
      (a.terms.feeAmount === null ||
        b.terms.feeAmount === null ||
        compareMoney(a.terms.feeAmount, b.terms.feeAmount) === 0)
    const included = expenses.filter((e) => e.currency === currency)
    const feeMode = latest?.terms.feeMode ?? fallbackTerms.feeMode
    return {
      payments,
      expenses: included,
      skippedExpenses: expenses.filter((e) => e.currency !== currency),
      rentTotal: sum(payments.map((p) => p.rentApplied)),
      lateFeeTotal: sum(payments.map((p) => p.lateFeeApplied)),
      ownerChargesTotal: sum(payments.map((p) => p.ownerChargesApplied)),
      serviceChargesTotal: sum(payments.map((p) => p.serviceChargesApplied)),
      feeBase: sum(fees.map((f) => f.base)),
      feePercentage: toMoneyString(
        latest?.terms.feePercentage ?? fallbackTerms.feePercentage,
      ),
      feeAmountFixed: latest?.terms.feeAmount ?? null,
      feeTotal: sum(fees.map((f) => f.amount)),
      feeMode,
      feeDeducted: FeePolicy.isDeducted(feeMode),
      mixedFeeTerms: fees.some((f) => !sameTerms(f, latest)),
      expensesTotal: sum(included.map((e) => e.amount)),
    }
  },

  /** Los tres rubros que restan van en negativo; el crédito, en positivo (3.1). */
  signedAmount(concept: SettlementAdjustmentConcept, amount: string): string {
    return concept === SettlementAdjustmentConcept.OTHER_CREDIT
      ? toMoneyString(amount)
      : toMoneyString(toDecimal(amount).negated())
  },

  adjustmentsTotal(
    adjustments: Pick<
      SettlementAdjustment,
      'concept' | 'amount' | 'voidedAt'
    >[],
  ): string {
    return sum(
      adjustments
        .filter((a) => a.voidedAt === null)
        .map((a) => this.signedAmount(a.concept, a.amount)),
    )
  },

  /**
   * Neto a transferir (4.3): `alquiler + punitorios + cargos del propietario
   * − (honorarios si se descuentan) − gastos + ajustes`. Los cargos SERVICE
   * quedan afuera (A-16: la inmobiliaria paga el servicio con esa plata).
   * Puede ser negativo: el propietario debe.
   */
  net(
    totals: Pick<
      SettlementTotals,
      | 'rentTotal'
      | 'lateFeeTotal'
      | 'ownerChargesTotal'
      | 'feeTotal'
      | 'feeDeducted'
      | 'expensesTotal'
    >,
    adjustmentsTotal: string,
  ): string {
    const gross = addMoney(
      totals.rentTotal,
      totals.lateFeeTotal,
      totals.ownerChargesTotal,
    )
    const deductions = addMoney(
      totals.feeDeducted ? totals.feeTotal : ZERO,
      totals.expensesTotal,
    )
    return toMoneyString(
      addMoney(subtractMoney(gross, deductions), adjustmentsTotal),
    )
  },

  /** Σ transferencias vigentes. */
  transferredTotal(settlement: Pick<Settlement, 'transfers'>): string {
    return sum(activeTransfers(settlement).map((t) => t.amount))
  },

  /** El estado después de tocar las transferencias (4.5). */
  statusAfterTransfers(
    settlement: Pick<Settlement, 'status' | 'netAmount'>,
    transferredTotal: string,
  ): SettlementStatus {
    if (!isConfirmed(settlement)) return settlement.status
    return compareMoney(settlement.netAmount, ZERO) > 0 &&
      compareMoney(transferredTotal, settlement.netAmount) >= 0
      ? SettlementStatus.TRANSFERRED
      : SettlementStatus.CONFIRMED
  },

  /** Las transferencias no pueden superar el neto; un neto ≤ 0 no admite ninguna. */
  assertTransferFits(
    settlement: Pick<Settlement, 'netAmount' | 'transfers'>,
    amount: string,
  ): void {
    const current = this.transferredTotal(settlement)
    const remaining = subtractMoney(settlement.netAmount, current)
    if (
      compareMoney(settlement.netAmount, ZERO) <= 0 ||
      toDecimal(amount).greaterThan(remaining)
    ) {
      throw new SettlementTransferExceedsNetException(
        toMoneyString(settlement.netAmount),
        remaining.isNegative() ? ZERO : toMoneyString(remaining),
      )
    }
  },

  assertPending(settlement: Pick<Settlement, 'id' | 'status'>): void {
    if (settlement.status !== SettlementStatus.PENDING) {
      throw new SettlementNotPendingException(settlement.id, settlement.status)
    }
  },

  assertConfirmed(settlement: Pick<Settlement, 'id' | 'status'>): void {
    if (!isConfirmed(settlement)) {
      throw new SettlementNotConfirmedException(
        settlement.id,
        settlement.status,
      )
    }
  },

  /** El siguiente número de liquidación parcial del mes (3.1). */
  nextSequence(maxExisting: number | null): number {
    return (maxExisting ?? 0) + 1
  },

  normalizeAmount(value: string, field = 'amount'): string {
    let amount
    try {
      amount = roundMoney(value)
    } catch {
      throw new InvalidSettlementAmountException(undefined, field)
    }
    if (amount.lessThanOrEqualTo(0)) {
      throw new InvalidSettlementAmountException(undefined, field)
    }
    return toMoneyString(amount)
  },

  /** Fecha real de la transferencia: válida y no futura. */
  normalizeDate(
    value: string,
    today: IsoDate,
    field = 'transferredAt',
  ): IsoDate {
    const trimmed = value.trim()
    if (!isValidIsoDate(trimmed)) {
      throw new InvalidSettlementDateException(
        'no es una fecha (AAAA-MM-DD)',
        field,
      )
    }
    if (trimmed > today) {
      throw new InvalidSettlementDateException('no puede ser futura', field)
    }
    return trimmed
  },

  normalizeDescription(value: string): string {
    const trimmed = value.trim().replace(/\s+/g, ' ')
    if (trimmed.length === 0) {
      throw new InvalidSettlementTextException(
        'description',
        'describí el ajuste',
      )
    }
    return trimmed.slice(0, 300)
  },

  normalizeReason(value: string): string {
    const trimmed = value.trim().replace(/\s+/g, ' ')
    if (trimmed.length === 0) {
      throw new InvalidSettlementTextException('reason', 'indicá el motivo')
    }
    return trimmed.slice(0, 500)
  },

  normalizeNotes(value: string | null | undefined): string | null {
    const trimmed = value?.trim().replace(/\s+/g, ' ') ?? ''
    return trimmed.length > 0 ? trimmed : null
  },

  /** Comprobante opcional: imagen (JPG, PNG, WebP) o PDF de hasta 10 MB. */
  receiptKind(file: Buffer | null | undefined): FileKind | null {
    if (!file || file.length === 0) return null
    if (file.length > MAX_RECEIPT_BYTES) {
      throw new InvalidSettlementReceiptException('tiene que pesar hasta 10 MB')
    }
    const kind = detectFileKind(file)
    if (!kind) {
      throw new InvalidSettlementReceiptException(
        'tiene que ser una imagen (JPG, PNG o WebP) o un PDF',
      )
    }
    return kind
  },

  /** Descripción del ajuste automático por un pago anulado (A-19). */
  voidedPaymentDescription(voided: {
    paidAt: IsoDate
    period: Period
    reason: string
  }): string {
    return `Pago anulado del ${voided.paidAt} (cuota ${voided.period}) ya liquidado: ${voided.reason}`
      .replace(/\s+/g, ' ')
      .slice(0, 300)
  },

  /** Lo que un pago anulado le había aportado al propietario (para descontarlo). */
  voidedPaymentAmount(voided: {
    rentApplied: string
    lateFeeApplied: string
    ownerChargesApplied: string
  }): string {
    return sum([
      voided.rentApplied,
      voided.lateFeeApplied,
      voided.ownerChargesApplied,
    ])
  },

  /**
   * Totales del consolidado por moneda (3.2, 4.7): suma de sus liquidaciones
   * sin mezclar monedas. Los cargos son los del propietario; los honorarios
   * se informan se descuenten o no.
   */
  statementTotals(
    settlements: Pick<
      Settlement,
      | 'currency'
      | 'rentTotal'
      | 'lateFeeTotal'
      | 'ownerChargesTotal'
      | 'feeTotal'
      | 'expensesTotal'
      | 'adjustmentsTotal'
      | 'netAmount'
      | 'transferredTotal'
    >[],
  ): OwnerStatementTotals[] {
    const currencies = [...new Set(settlements.map((s) => s.currency))].sort()
    return currencies.map((currency) => {
      const group = settlements.filter((s) => s.currency === currency)
      const total = (pick: (s: (typeof group)[number]) => string) =>
        sum(group.map(pick))
      return {
        currency,
        rentTotal: total((s) => s.rentTotal),
        lateFeeTotal: total((s) => s.lateFeeTotal),
        chargesTotal: total((s) => s.ownerChargesTotal),
        feeTotal: total((s) => s.feeTotal),
        expensesTotal: total((s) => s.expensesTotal),
        adjustmentsTotal: total((s) => s.adjustmentsTotal),
        netTotal: total((s) => s.netAmount),
        transferredTotal: total((s) => s.transferredTotal),
      }
    })
  },

  activeAdjustments,
}
