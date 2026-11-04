import {
  addDays,
  addMonths,
  daysBetween,
  fullMonthsBetween,
  IsoDate,
  isValidIsoDate,
  minIsoDate,
} from '@/shared/dates/calendar-date'
import {
  addMoney,
  multiplyMoney,
  percentageOf,
  roundMoney,
  toDecimal,
  toMoneyString,
} from '@/shared/money'
import {
  BillingTerms,
  ContractStatus,
  LateFeeDefaults,
  RentUpdateFrequency,
  ResolvedBillingTerms,
} from './contract'
import {
  BillingTermsNotAfterLatestException,
  LateFeePercentageRequiredException,
  ManualRentAdjustmentJustificationException,
  BillingTermsOutOfRangeException,
  ContractDatesInvalidException,
  InvalidBillingTermsException,
  InvalidContractDateException,
  NewRentRequiredException,
  RenewalStartInvalidException,
  SuretyEmailRequiredException,
  TerminationDateInvalidException,
} from './contract.exceptions'

/**
 * Multa por rescisión anticipada: % del canon futuro (RN-09). Hoy es una
 * constante del PRD; si una inmobiliaria quisiera otra, pasa a `tenants`
 * como los honorarios (D-56).
 */
export const TERMINATION_PENALTY_PERCENT = '10'

/** Los días sueltos del canon futuro se prorratean a mes de 30 días (D-56). */
export const DAYS_PER_MONTH = 30

const MONTHS_PER_UPDATE: Record<RentUpdateFrequency, number> = {
  [RentUpdateFrequency.MONTHLY]: 1,
  [RentUpdateFrequency.QUARTERLY]: 3,
  [RentUpdateFrequency.FOUR_MONTHLY]: 4,
  [RentUpdateFrequency.SEMIANNUAL]: 6,
  [RentUpdateFrequency.ANNUAL]: 12,
}

export interface FeeSettings {
  standardFeePercentage: string
  reducedFeePercentage: string
}

export interface TerminationBreakdown {
  currentRent: string
  /** Meses enteros desde la notificación hasta el fin. */
  remainingMonths: number
  /** Días sueltos después de esos meses, hasta el fin (sin contar el fin). */
  remainingDays: number
  /** Total de días desde la notificación hasta el fin. */
  totalDays: number
  futureRent: string
  penalty: string
}

export interface Timeline {
  totalMonths: number
  elapsedMonths: number
  /** 0 a 100, entero. */
  progressPercent: number
}

/** Reglas de negocio de los contratos. Puras: sin NestJS ni Prisma. */
export const ContractPolicy = {
  /** Fecha `AAAA-MM-DD` que exista en el calendario. */
  normalizeDate(value: string, field: string): IsoDate {
    const trimmed = value.trim()
    if (!isValidIsoDate(trimmed)) throw new InvalidContractDateException(field)
    return trimmed
  },

  /** Spec 3.1: fin posterior al inicio (400). */
  assertDates(startDate: IsoDate, endDate: IsoDate): void {
    if (endDate <= startDate) throw new ContractDatesInvalidException()
  },

  /** Spec 3.1: con caución, el email de alerta es obligatorio (400). */
  assertSurety(hasSurety: boolean, insurerAlertEmail: string | null): void {
    if (hasSurety && !insurerAlertEmail)
      throw new SuretyEmailRequiredException()
  },

  /**
   * Honorarios del contrato (RN-06/RN-07), fijados al crear y nunca
   * recalculados (spec 4). Si el honorario reducido aplica lo decide
   * `appliesReducedFee` (propietarios); acá sólo se elige el porcentaje.
   */
  feePercentage(reduced: boolean, settings: FeeSettings): string {
    return toMoneyString(
      reduced ? settings.reducedFeePercentage : settings.standardFeePercentage,
    )
  },

  monthsBetweenUpdates(frequency: RentUpdateFrequency): number {
    return MONTHS_PER_UPDATE[frequency]
  },

  /** Fecha del próximo aumento: la del último más la frecuencia. */
  nextRentUpdateOn(
    latestEffectiveFrom: IsoDate,
    frequency: RentUpdateFrequency,
  ): IsoDate {
    return addMonths(latestEffectiveFrom, MONTHS_PER_UPDATE[frequency])
  },

  /**
   * Aumento por índice (RN-15): el alquiler se multiplica por la variación
   * del índice entre el período anterior y el nuevo. La razón se calcula
   * con toda la precisión y se redondea una sola vez, a centavos.
   */
  indexedRent(
    currentRent: string,
    indexFromValue: string,
    indexToValue: string,
  ): string {
    const ratio = toDecimal(indexToValue).dividedBy(toDecimal(indexFromValue))
    return toMoneyString(multiplyMoney(currentRent, ratio))
  },

  /**
   * Aumento por % fijo (Micaela #8): `nuevo = vigente × (1 + % / 100)`, con
   * un solo redondeo a centavos.
   */
  fixedIncreaseRent(currentRent: string, percentage: string): string {
    const factor = toDecimal(percentage).dividedBy(100).plus(1)
    return toMoneyString(multiplyMoney(currentRent, factor))
  },

  /** Un % entre 0 y 100, con hasta dos decimales. */
  normalizePercentage(value: string, field: string): string {
    let percentage
    try {
      percentage = roundMoney(value)
    } catch {
      throw new InvalidBillingTermsException(field, 'tiene que ser un número')
    }
    if (percentage.isNegative() || percentage.greaterThan(100)) {
      throw new InvalidBillingTermsException(
        field,
        'tiene que estar entre 0 y 100',
      )
    }
    return toMoneyString(percentage)
  },

  /** El importe fijo de honorarios, mayor que cero. Null = se usa el %. */
  normalizeFeeAmount(value: string | null): string | null {
    if (value === null) return null
    let amount
    try {
      amount = roundMoney(value)
    } catch {
      throw new InvalidBillingTermsException(
        'feeAmount',
        'tiene que ser un número',
      )
    }
    if (amount.lessThanOrEqualTo(0)) {
      throw new InvalidBillingTermsException(
        'feeAmount',
        'tiene que ser mayor que cero',
      )
    }
    return toMoneyString(amount)
  },

  /** Días de gracia: entero de 0 o más. Null = el del tenant. */
  normalizeGraceDays(value: number | null): number | null {
    if (value === null) return null
    if (!Number.isInteger(value) || value < 0) {
      throw new InvalidBillingTermsException(
        'lateFeeGraceDays',
        'tiene que ser un entero de cero o más',
      )
    }
    return value
  },

  /**
   * Los términos nuevos rigen desde una fecha dentro del contrato y no
   * anterior a los últimos cargados (D-70): la misma fecha vale (corrige la
   * fila del día; la más nueva manda).
   */
  assertBillingTermsEffectiveFrom(
    effectiveFrom: IsoDate,
    latestEffectiveFrom: IsoDate,
    startDate: IsoDate,
    endDate: IsoDate,
  ): void {
    if (effectiveFrom < startDate || effectiveFrom > endDate) {
      throw new BillingTermsOutOfRangeException()
    }
    if (effectiveFrom < latestEffectiveFrom) {
      throw new BillingTermsNotAfterLatestException(latestEffectiveFrom)
    }
  },

  /**
   * "Desde cuándo corre" el punitorio (D-227): el contrato puede indicar el
   * día del mes de inicio (`lateFeeStartDay`, 1 a 31) en vez de los días de
   * gracia; es lo mismo dicho al revés (inicio = gracia + 1), así que se
   * guarda como gracia y las cuotas y contratos existentes no cambian. Los
   * dos a la vez son ambiguos y se rechazan. Devuelve la gracia a guardar
   * (`undefined`/`null` conservan su significado: sin cambio / heredar).
   */
  resolveGraceInput(
    graceDays: number | null | undefined,
    startDay: number | null | undefined,
  ): number | null | undefined {
    if (startDay === undefined || startDay === null) return graceDays
    if (graceDays !== undefined && graceDays !== null) {
      throw new InvalidBillingTermsException(
        'lateFeeStartDay',
        'no se combina con lateFeeGraceDays: indicá uno solo',
      )
    }
    if (!Number.isInteger(startDay) || startDay < 1 || startDay > 31) {
      throw new InvalidBillingTermsException(
        'lateFeeStartDay',
        'tiene que ser un día del mes entre 1 y 31',
      )
    }
    return startDay - 1
  },

  /**
   * Un contrato necesita un punitorio de dónde sacarlo: el suyo o el de la
   * inmobiliaria (D-227, Micaela #3: no hay un 5 % obligatorio por defecto).
   */
  assertLateFeeSource(
    lateFeePercentage: string | null,
    defaults: LateFeeDefaults,
  ): void {
    if (
      lateFeePercentage === null &&
      defaults.dailyLateFeePercentage === null
    ) {
      throw new LateFeePercentageRequiredException()
    }
  },

  /** Completa el punitorio con el del tenant donde el contrato no lo fijó. */
  resolveBillingTerms(
    terms: BillingTerms,
    defaults: LateFeeDefaults,
  ): ResolvedBillingTerms {
    return {
      ...terms,
      // Sin ninguno de los dos (no debería pasar: las altas lo exigen) no hay
      // punitorio, antes que inventar uno.
      lateFeePercentage:
        terms.lateFeePercentage ??
        toMoneyString(defaults.dailyLateFeePercentage ?? '0'),
      lateFeeGraceDays: terms.lateFeeGraceDays ?? defaults.paymentGraceDays,
      lateFeeStartDay:
        (terms.lateFeeGraceDays ?? defaults.paymentGraceDays) + 1,
      inheritedLateFeePercentage: terms.lateFeePercentage === null,
      inheritedLateFeeGraceDays: terms.lateFeeGraceDays === null,
    }
  },

  /**
   * Un ajuste manual del alquiler (Micaela #8: "ajustes manuales autorizados")
   * deja constancia de por qué se hizo y quién lo autorizó (D-229).
   */
  normalizeManualAdjustment(
    reason: string | null | undefined,
    authorizedBy: string | null | undefined,
  ): { adjustmentReason: string; authorizedBy: string } {
    const clean = (value: string | null | undefined) =>
      (value ?? '').trim().replace(/\s+/g, ' ')
    const adjustmentReason = clean(reason)
    const authorizer = clean(authorizedBy)
    if (adjustmentReason.length === 0) {
      throw new ManualRentAdjustmentJustificationException(
        'reason',
        'es obligatorio',
      )
    }
    if (authorizer.length === 0) {
      throw new ManualRentAdjustmentJustificationException(
        'authorizedBy',
        'es obligatorio',
      )
    }
    if (adjustmentReason.length > 500) {
      throw new ManualRentAdjustmentJustificationException(
        'reason',
        'admite hasta 500 caracteres',
      )
    }
    if (authorizer.length > 150) {
      throw new ManualRentAdjustmentJustificationException(
        'authorizedBy',
        'admite hasta 150 caracteres',
      )
    }
    return { adjustmentReason, authorizedBy: authorizer }
  },

  /** Un aumento a mano tiene que traer un monto mayor que cero. */
  normalizeNewRent(value: string | null | undefined): string {
    if (!value) throw new NewRentRequiredException()
    const rent = roundMoney(value)
    if (rent.lessThanOrEqualTo(0)) throw new NewRentRequiredException()
    return toMoneyString(rent)
  },

  /**
   * Rescisión (spec 7): se notifica desde el inicio del contrato y antes
   * del día de fin. Notificar el mismo día del fin o después no tiene
   * sentido: ya venció.
   */
  assertTerminationDate(
    notifiedAt: IsoDate,
    startDate: IsoDate,
    endDate: IsoDate,
  ): void {
    if (notifiedAt < startDate || notifiedAt >= endDate) {
      throw new TerminationDateInvalidException()
    }
  },

  /**
   * Multa por rescisión anticipada (RN-09, D-56). Canon futuro = alquiler
   * vigente × meses enteros que quedan + alquiler × días sueltos / 30; la
   * multa es el 10 % de eso. Los meses se cuentan desde la fecha de
   * notificación (mismo día de cada mes) y los días van hasta el fin sin
   * contarlo: notificado el 1 para un contrato que termina el 31, quedan 30
   * días = exactamente un mes de alquiler (los días se redondean una sola
   * vez, no por día: 30 × 3.333,33 daría 99.999,90). No se proyectan
   * aumentos futuros (spec 4).
   */
  termination(
    currentRent: string,
    notifiedAt: IsoDate,
    endDate: IsoDate,
  ): TerminationBreakdown {
    const remainingMonths = fullMonthsBetween(notifiedAt, endDate)
    const afterMonths = addMonths(notifiedAt, remainingMonths)
    const remainingDays = daysBetween(afterMonths, endDate)
    const daysRent = roundMoney(
      toDecimal(currentRent).times(remainingDays).dividedBy(DAYS_PER_MONTH),
    )
    const futureRent = addMoney(
      multiplyMoney(currentRent, String(remainingMonths)),
      daysRent,
    )
    const penalty = percentageOf(futureRent, TERMINATION_PENALTY_PERCENT)
    return {
      currentRent: toMoneyString(currentRent),
      remainingMonths,
      remainingDays,
      totalDays: daysBetween(notifiedAt, endDate),
      futureRent: toMoneyString(futureRent),
      penalty: toMoneyString(penalty),
    }
  },

  /** Una renovación no empieza antes que el contrato que renueva. */
  assertRenewalStart(newStartDate: IsoDate, originalStartDate: IsoDate): void {
    if (newStartDate < originalStartDate)
      throw new RenewalStartInvalidException()
  },

  /** RN-16: póliza vencida = hay caución y la póliza venció antes de hoy. */
  isSuretyExpired(
    hasSurety: boolean,
    policyExpiresAt: IsoDate | null,
    today: IsoDate,
  ): boolean {
    return hasSurety && policyExpiresAt !== null && policyExpiresAt < today
  },

  /**
   * Por vencer (RN-12, spec 3.2): activo y termina dentro de los próximos
   * `noticeDays` días, hoy inclusive. Uno ya vencido no está "por vencer":
   * está vencido.
   */
  isExpiringSoon(
    status: ContractStatus,
    endDate: IsoDate,
    today: IsoDate,
    noticeDays: number,
  ): boolean {
    return (
      status === ContractStatus.ACTIVE &&
      endDate >= today &&
      endDate <= addDays(today, noticeDays)
    )
  },

  /** Vencido sin renovar (PRD 9.1): sigue activo pero ya pasó su fin. */
  isExpired(status: ContractStatus, endDate: IsoDate, today: IsoDate): boolean {
    return status === ContractStatus.ACTIVE && endDate < today
  },

  /**
   * Línea de tiempo (spec 3.3): meses totales y transcurridos, y el avance
   * en días. El fin es inclusive, así que un contrato del 1/1 al 31/12 son
   * 12 meses y el último día está al 100 %.
   */
  timeline(startDate: IsoDate, endDate: IsoDate, today: IsoDate): Timeline {
    const exclusiveEnd = addDays(endDate, 1)
    const totalMonths = fullMonthsBetween(startDate, exclusiveEnd)
    const totalDays = daysBetween(startDate, exclusiveEnd)
    if (today < startDate) {
      return { totalMonths, elapsedMonths: 0, progressPercent: 0 }
    }
    const cursor = minIsoDate(today, endDate)
    const elapsedMonths = Math.min(
      totalMonths,
      fullMonthsBetween(startDate, addDays(cursor, 1)),
    )
    const elapsedDays = daysBetween(startDate, cursor) + 1
    const progressPercent = Math.min(
      100,
      Math.max(0, Math.round((elapsedDays * 100) / totalDays)),
    )
    return { totalMonths, elapsedMonths, progressPercent }
  },
}
