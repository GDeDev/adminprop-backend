import { IsoDate, isValidIsoDate } from '@/shared/dates/calendar-date'
import { detectFileKind, FileKind } from '@/shared/files/file-signature'
import {
  compareMoney,
  roundMoney,
  subtractMoney,
  toDecimal,
  toMoneyString,
} from '@/shared/money'
import {
  CollectionMode,
  Currency,
  ExchangeRateSource,
  Installment,
  PaymentReceiver,
  PaymentStatus,
  RenterCredit,
} from './billing'
import {
  CreditCurrencyMismatchException,
  CreditNotAvailableException,
  ExchangeRateNotAllowedException,
  ExchangeRateRequiredException,
  InvalidAllocationException,
  InvalidPaymentAmountException,
  InvalidPaymentDateException,
  InvalidPaymentReceiptException,
  PaymentDateBeforeLateFeePaymentException,
} from './billing.exceptions'
import { InstallmentBalances } from './installment.policy'

/** 10 MB, como los comprobantes de gastos adelantados (D-67). */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024

const ZERO = toMoneyString('0')

/** La cotización tal como viene; los tres juntos o ninguno. */
export interface ExchangeRateInput {
  rate: string | null
  source: ExchangeRateSource | null
  date: string | null
}

export interface ExchangeRate {
  rate: string
  source: ExchangeRateSource
  date: IsoDate
}

export interface Conversion {
  exchangeRate: ExchangeRate | null
  amountInContractCurrency: string
}

/** Cuánto va a cada concepto, en moneda del contrato (regla 4). */
export interface Allocation {
  lateFeeApplied: string
  rentApplied: string
  chargesApplied: string
  /** Lo que sobró después de cubrir todo: nace como saldo a favor (A-6). */
  creditGenerated: string
}

export interface ManualAllocation {
  lateFee: string
  rent: string
  charges: string
}

/** Qué crédito aplicar y por cuánto (regla 5). */
export interface CreditApplicationPlan {
  credit: RenterCredit
  amount: string
}

/** Reglas de los pagos. Puras: sin NestJS ni Prisma. */
export const PaymentPolicy = {
  /** Mayor que cero: un pago sin plata sólo existe como aplicación de crédito. */
  normalizeAmount(value: string): string {
    let amount
    try {
      amount = roundMoney(value)
    } catch {
      throw new InvalidPaymentAmountException()
    }
    if (amount.lessThanOrEqualTo(0)) throw new InvalidPaymentAmountException()
    return toMoneyString(amount)
  },

  /**
   * Regla 10: la fecha real del pago, no futura. El diseño pedía además "no
   * anterior al mes de la cuota", pero eso impide el pago anticipado que
   * A-14 contempla (cobrar en octubre la cuota de noviembre), así que se
   * acepta cualquier fecha pasada: pagar antes de la gracia simplemente no
   * devenga punitorio.
   */
  normalizePaidAt(value: string, today: IsoDate): IsoDate {
    const trimmed = value.trim()
    if (!isValidIsoDate(trimmed)) {
      throw new InvalidPaymentDateException('no es una fecha (AAAA-MM-DD)')
    }
    if (trimmed > today) {
      throw new InvalidPaymentDateException('no puede ser futura')
    }
    return trimmed
  },

  /**
   * Cotización (A-9, Micaela #2): obligatoria entera cuando la moneda del
   * pago no es la de la cuota, prohibida cuando coinciden. Convención:
   * pesos por 1 dólar. Pago en ARS a cuota USD: `amount / rate`; en USD a
   * cuota ARS: `amount × rate`; un solo redondeo.
   */
  convert(
    amount: string,
    paidCurrency: Currency,
    contractCurrency: Currency,
    input: ExchangeRateInput,
  ): Conversion {
    const given =
      input.rate !== null || input.source !== null || input.date !== null
    if (paidCurrency === contractCurrency) {
      if (given) throw new ExchangeRateNotAllowedException()
      return { exchangeRate: null, amountInContractCurrency: amount }
    }
    if (input.rate === null || input.source === null || input.date === null) {
      throw new ExchangeRateRequiredException()
    }
    let rate
    try {
      rate = toDecimal(input.rate).toDecimalPlaces(4)
    } catch {
      throw new ExchangeRateRequiredException()
    }
    if (rate.lessThanOrEqualTo(0)) throw new ExchangeRateRequiredException()
    const date = input.date.trim()
    if (!isValidIsoDate(date)) {
      throw new InvalidPaymentDateException(
        'no es una fecha (AAAA-MM-DD)',
        'exchangeRateDate',
      )
    }
    const converted =
      contractCurrency === Currency.USD
        ? toDecimal(amount).dividedBy(rate)
        : toDecimal(amount).times(rate)
    return {
      exchangeRate: { rate: rate.toFixed(4), source: input.source, date },
      amountInContractCurrency: toMoneyString(converted),
    }
  },

  /** Quién recibió la plata: lo que diga el pago, si no según la modalidad. */
  receiver(
    requested: PaymentReceiver | null,
    collectionMode: CollectionMode,
  ): PaymentReceiver {
    if (requested) return requested
    return collectionMode === CollectionMode.OWNER_DIRECT
      ? PaymentReceiver.OWNER
      : PaymentReceiver.AGENCY
  },

  /** Recibido por la inmobiliaria nace confirmado; por el propietario, informado. */
  initialStatus(receivedBy: PaymentReceiver): PaymentStatus {
    return receivedBy === PaymentReceiver.AGENCY
      ? PaymentStatus.CONFIRMED
      : PaymentStatus.PENDING_CONFIRMATION
  },

  /**
   * Imputación (regla 4, A-8): por defecto punitorio → alquiler → cargos
   * hasta agotar el monto; lo que sobra es saldo a favor. Si Micaela pide
   * otro orden, se cambia acá y los pagos ya registrados conservan el suyo.
   * Con `manual`, cada concepto va hasta su saldo y la suma no puede superar
   * el monto; si queda un resto, sólo es crédito con todo cubierto.
   */
  allocate(
    amountInContractCurrency: string,
    balances: Pick<
      InstallmentBalances,
      'lateFeeBalance' | 'rentBalance' | 'chargesBalance'
    >,
    manual: ManualAllocation | null,
  ): Allocation {
    const amount = toDecimal(amountInContractCurrency)
    if (manual) {
      const parse = (value: string, field: string) => {
        let parsed
        try {
          parsed = roundMoney(value)
        } catch {
          throw new InvalidAllocationException(`${field} no es un número`)
        }
        if (parsed.isNegative()) {
          throw new InvalidAllocationException(`${field} no puede ser negativo`)
        }
        return parsed
      }
      const lateFee = parse(manual.lateFee, 'lateFee')
      const rent = parse(manual.rent, 'rent')
      const charges = parse(manual.charges, 'charges')
      if (lateFee.greaterThan(toDecimal(balances.lateFeeBalance))) {
        throw new InvalidAllocationException(
          `lateFee supera el punitorio pendiente (${balances.lateFeeBalance})`,
        )
      }
      if (rent.greaterThan(toDecimal(balances.rentBalance))) {
        throw new InvalidAllocationException(
          `rent supera el alquiler pendiente (${balances.rentBalance})`,
        )
      }
      if (charges.greaterThan(toDecimal(balances.chargesBalance))) {
        throw new InvalidAllocationException(
          `charges supera los cargos pendientes (${balances.chargesBalance})`,
        )
      }
      const allocated = lateFee.plus(rent).plus(charges)
      if (allocated.greaterThan(amount)) {
        throw new InvalidAllocationException(
          'la suma de los conceptos supera el monto del pago',
        )
      }
      const rest = amount.minus(allocated)
      const everythingCovered =
        lateFee.equals(toDecimal(balances.lateFeeBalance)) &&
        rent.equals(toDecimal(balances.rentBalance)) &&
        charges.equals(toDecimal(balances.chargesBalance))
      if (rest.greaterThan(0) && !everythingCovered) {
        throw new InvalidAllocationException(
          'la suma de los conceptos tiene que ser igual al monto del pago mientras quede saldo',
        )
      }
      return {
        lateFeeApplied: toMoneyString(lateFee),
        rentApplied: toMoneyString(rent),
        chargesApplied: toMoneyString(charges),
        creditGenerated: toMoneyString(rest),
      }
    }

    let remaining = amount
    const take = (balance: string) => {
      const portion = remaining.lessThan(toDecimal(balance))
        ? remaining
        : toDecimal(balance)
      remaining = remaining.minus(portion)
      return toMoneyString(portion)
    }
    const lateFeeApplied = take(balances.lateFeeBalance)
    const rentApplied = take(balances.rentBalance)
    const chargesApplied = take(balances.chargesBalance)
    return {
      lateFeeApplied,
      rentApplied,
      chargesApplied,
      creditGenerated: toMoneyString(remaining),
    }
  },

  /** Los saldos que quedan después de imputar un pago. */
  remainingAfter<
    T extends Pick<
      InstallmentBalances,
      'lateFeeBalance' | 'rentBalance' | 'chargesBalance'
    >,
  >(balances: T, allocation: Allocation): T {
    return {
      ...balances,
      lateFeeBalance: toMoneyString(
        subtractMoney(balances.lateFeeBalance, allocation.lateFeeApplied),
      ),
      rentBalance: toMoneyString(
        subtractMoney(balances.rentBalance, allocation.rentApplied),
      ),
      chargesBalance: toMoneyString(
        subtractMoney(balances.chargesBalance, allocation.chargesApplied),
      ),
    }
  },

  /**
   * Un pago no puede ir antes que otro vigente que ya imputó punitorio: el
   * punitorio de un día depende de qué pagos tienen fecha anterior, y lo ya
   * imputado no se reimputa (alto 5, D-261).
   */
  assertNotBeforeLateFeePayment(
    installment: Pick<Installment, 'payments'>,
    paidAt: IsoDate,
  ): void {
    const later = installment.payments.find(
      (p) =>
        p.status !== PaymentStatus.VOIDED &&
        p.paidAt > paidAt &&
        compareMoney(p.lateFeeApplied, ZERO) > 0,
    )
    if (later) {
      throw new PaymentDateBeforeLateFeePaymentException(later.id, later.paidAt)
    }
  },

  /**
   * Los saldos que se pueden aplicar a esta cuota. Uno que tiene la
   * inmobiliaria, a cualquiera del inquilino. Uno que tiene el propietario
   * (nació de un cobro directo), sólo a cuotas de su mismo contrato: en otro
   * contrato sería plata de un propietario cubriendo el alquiler de otro, o
   * una cuota de la inmobiliaria pagada con plata que ella no tiene
   * (crítico 3).
   */
  usableCredits(
    credits: RenterCredit[],
    installment: Pick<Installment, 'contractId'>,
  ): RenterCredit[] {
    return credits.filter(
      (c) =>
        c.heldBy === PaymentReceiver.AGENCY ||
        c.contractId === installment.contractId,
    )
  },

  /**
   * Plan de aplicación de saldos a favor (regla 5): los disponibles del
   * inquilino en la moneda del contrato, del más viejo al más nuevo, cada
   * uno hasta su `remaining`, hasta cubrir `totalDue`. Con `creditId` sólo
   * ese; con `amount`, hasta ese monto.
   */
  planCreditApplications(
    credits: RenterCredit[],
    totalDue: string,
    contractCurrency: Currency,
    options: { creditId?: string; amount?: string } = {},
  ): CreditApplicationPlan[] {
    let target = toDecimal(totalDue)
    if (options.amount !== undefined) {
      const requested = toDecimal(this.normalizeAmount(options.amount))
      if (requested.greaterThan(target)) {
        throw new CreditNotAvailableException(
          `el monto supera lo que debe la cuota (${totalDue})`,
        )
      }
      target = requested
    }
    let candidates = credits
    if (options.creditId) {
      const chosen = credits.find((c) => c.id === options.creditId)
      if (!chosen) throw new CreditNotAvailableException()
      if (chosen.currency !== contractCurrency) {
        throw new CreditCurrencyMismatchException()
      }
      candidates = [chosen]
    }
    const plan: CreditApplicationPlan[] = []
    for (const credit of candidates) {
      if (target.lessThanOrEqualTo(0)) break
      if (credit.currency !== contractCurrency) continue
      if (compareMoney(credit.remaining, ZERO) <= 0) continue
      const remaining = toDecimal(credit.remaining)
      const amount = remaining.lessThan(target) ? remaining : target
      plan.push({ credit, amount: toMoneyString(amount) })
      target = target.minus(amount)
    }
    return plan
  },

  /**
   * El comprobante es opcional (D-74: efectivo puede no tener). Si viene,
   * imagen (JPG, PNG, WebP) o PDF de hasta 10 MB, por sus primeros bytes.
   */
  receiptKind(file: Buffer | null | undefined): FileKind | null {
    if (!file || file.length === 0) return null
    if (file.length > MAX_RECEIPT_BYTES) {
      throw new InvalidPaymentReceiptException('tiene que pesar hasta 10 MB')
    }
    const kind = detectFileKind(file)
    if (!kind) {
      throw new InvalidPaymentReceiptException(
        'tiene que ser una imagen (JPG, PNG o WebP) o un PDF',
      )
    }
    return kind
  },

  /** El `allocation` del multipart llega como string JSON. */
  parseAllocation(raw: string | null | undefined): ManualAllocation | null {
    if (raw === null || raw === undefined || raw.trim() === '') return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new InvalidAllocationException('no es un JSON válido')
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new InvalidAllocationException('tiene que ser un objeto')
    }
    const record = parsed as Record<string, unknown>
    const field = (key: string): string => {
      const value = record[key]
      if (value === undefined || value === null) return ZERO
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new InvalidAllocationException(`${key} tiene que ser un monto`)
      }
      return String(value)
    }
    return {
      lateFee: field('lateFee'),
      rent: field('rent'),
      charges: field('charges'),
    }
  },
}
