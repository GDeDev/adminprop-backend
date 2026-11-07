import type { IsoDate } from './calendar-date'

/**
 * Zona horaria de todas las inmobiliarias (Fase 13, A-22). Argentina no usa
 * horario de verano; si algún día hace falta otra, va en `tenants.timezone`.
 */
export const APP_TIME_ZONE = 'America/Argentina/Buenos_Aires'

/** Un instante visto desde una zona: la fecha y la hora del reloj de pared. */
export interface LocalMoment {
  date: IsoDate
  /** `HH:MM`, 24 horas. */
  time: string
}

function partsOf(instant: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  return Object.fromEntries(
    formatter.formatToParts(instant).map((p) => [p.type, p.value]),
  )
}

/** Qué fecha y qué hora es en esa zona en el instante dado. */
export function localMoment(
  instant: Date = new Date(),
  timeZone: string = APP_TIME_ZONE,
): LocalMoment {
  const p = partsOf(instant, timeZone)
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
  }
}

/** El instante en que el reloj de esa zona marca `date` y `time` (`HH:MM`). */
export function instantOf(
  date: IsoDate,
  time: string,
  timeZone: string = APP_TIME_ZONE,
): Date {
  // Se parte de la hora como si fuera UTC y se corrige por lo que difiere el
  // reloj de la zona; con una zona sin horario de verano alcanza una vuelta.
  const guess = new Date(`${date}T${time}:00.000Z`)
  const p = partsOf(guess, timeZone)
  const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  return new Date(guess.getTime() - (seen - guess.getTime()))
}
