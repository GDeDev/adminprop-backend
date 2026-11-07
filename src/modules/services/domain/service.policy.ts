import {
  daysBetween,
  IsoDate,
  isValidIsoDate,
} from '@/shared/dates/calendar-date'
import { IncreaseFrequency, ServiceStatus } from './property-service'
import {
  InvalidServiceDateException,
  ServiceDueDateRequiredException,
  ServiceIncreaseFrequencyRequiredException,
} from './service.exceptions'

/** Vencimiento y aumentos de un servicio, como vienen del cliente. */
export interface ServiceSchedule {
  hasDueDate: boolean
  dueDate: string | null
  hasIncrease: boolean
  increaseFrequency: IncreaseFrequency | null
}

/** Lo mismo, ya validado: sin vencimiento no hay fecha, sin aumento no hay frecuencia. */
export interface NormalizedServiceSchedule {
  hasDueDate: boolean
  dueDate: IsoDate | null
  hasIncrease: boolean
  increaseFrequency: IncreaseFrequency | null
}

/** Reglas de negocio de los servicios. Puras: sin NestJS ni Prisma. */
export const ServicePolicy = {
  /** Fecha `AAAA-MM-DD` que exista en el calendario. */
  normalizeDate(value: string, field: string): IsoDate {
    const trimmed = value.trim()
    if (!isValidIsoDate(trimmed)) throw new InvalidServiceDateException(field)
    return trimmed
  },

  /**
   * Spec 6: con vencimiento, la fecha es obligatoria (400); con aumentos, la
   * frecuencia (400). Al revés, lo que no aplica se descarta: un servicio
   * "sin vencimiento" no guarda una fecha vieja que después lo marque
   * vencido.
   */
  normalizeSchedule(schedule: ServiceSchedule): NormalizedServiceSchedule {
    if (schedule.hasDueDate && !schedule.dueDate) {
      throw new ServiceDueDateRequiredException()
    }
    if (schedule.hasIncrease && !schedule.increaseFrequency) {
      throw new ServiceIncreaseFrequencyRequiredException()
    }
    return {
      hasDueDate: schedule.hasDueDate,
      dueDate:
        schedule.hasDueDate && schedule.dueDate
          ? this.normalizeDate(schedule.dueDate, 'dueDate')
          : null,
      hasIncrease: schedule.hasIncrease,
      increaseFrequency: schedule.hasIncrease
        ? schedule.increaseFrequency
        : null,
    }
  },

  /**
   * Spec 4: vencido cuando la fecha de vencimiento ya pasó (estrictamente
   * antes de hoy: el día del vencimiento todavía se puede pagar). Se calcula
   * al leer, nunca se guarda (D-64).
   */
  isOverdue(hasDueDate: boolean, dueDate: IsoDate | null, today: IsoDate) {
    return hasDueDate && dueDate !== null && dueDate < today
  },

  status(
    hasDueDate: boolean,
    dueDate: IsoDate | null,
    today: IsoDate,
  ): ServiceStatus {
    return this.isOverdue(hasDueDate, dueDate, today)
      ? ServiceStatus.OVERDUE
      : ServiceStatus.UP_TO_DATE
  },

  /**
   * Días desde el vencimiento: venció ayer = 1. Cero si no está vencido. La
   * alerta de la Fase 13 sale a partir del 5° día (RN-13).
   */
  daysOverdue(
    hasDueDate: boolean,
    dueDate: IsoDate | null,
    today: IsoDate,
  ): number {
    if (!this.isOverdue(hasDueDate, dueDate, today) || dueDate === null) {
      return 0
    }
    return daysBetween(dueDate, today)
  },
}
