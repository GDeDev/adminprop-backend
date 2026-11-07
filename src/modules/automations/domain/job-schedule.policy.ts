import { addDays, IsoDate } from '@/shared/dates/calendar-date'
import { instantOf, LocalMoment } from '@/shared/dates/zoned-time'
import { JobDefinition } from './job-catalog'

/**
 * Cuándo corre cada job. Puro: recibe el reloj local ya resuelto.
 *
 * El scheduler no confía en que el servidor estuviera prendido a la hora
 * exacta: cada 10 minutos pregunta "¿cuántas corridas de hoy ya tenían que
 * haber pasado y cuántas se hicieron?" (Fase 13, 1, recuperación de días
 * perdidos).
 */
export const JobSchedulePolicy = {
  /** Cuántas corridas del día ya tenían que haber salido a esa hora. */
  slotsDue(definition: JobDefinition, now: LocalMoment): number {
    return definition.times.filter((time) => time <= now.time).length
  },

  /** Cuántas hay que encolar, dado cuántas se encolaron hoy. */
  missingRuns(
    definition: JobDefinition,
    now: LocalMoment,
    alreadyScheduled: number,
  ): number {
    return Math.max(0, this.slotsDue(definition, now) - alreadyScheduled)
  },

  /** La próxima corrida programada (ISO), hoy o mañana. */
  nextRunAt(definition: JobDefinition, now: LocalMoment, from: Date): Date {
    const today = definition.times
      .map((time) => instantOf(now.date, time))
      .find((instant) => instant.getTime() > from.getTime())
    if (today) return today
    const tomorrow: IsoDate = addDays(now.date, 1)
    return instantOf(tomorrow, definition.times[0])
  },
}
