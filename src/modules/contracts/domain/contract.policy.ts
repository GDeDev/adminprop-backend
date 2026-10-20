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
import { ContractStatus, RentUpdateFrequency } from './contract'
import {
  ContractDatesInvalidException,
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
