import {
  addDays,
  addMonths,
  firstDayOfPeriod,
  IsoDate,
  lastDayOfPeriod,
  Period,
  periodOf,
} from '@/shared/dates/calendar-date'

/**
 * Las fechas del seed son relativas al día en que corre, para que siempre
 * haya cuotas vencidas, un contrato por vencer, etc. `offset` es la cantidad
 * de meses respecto del mes actual (-1 = el mes pasado, 1 = el que viene).
 */
export interface DemoCalendar {
  today: IsoDate
  currentPeriod: Period
  /** `AAAA-MM` del mes `offset`. */
  period(offset: number): Period
  /** Primer día del mes `offset`. */
  monthStart(offset: number): IsoDate
  /** El día `day` (1-based) del mes `offset`, sin pasarse del fin de mes. */
  dayOf(offset: number, day: number): IsoDate
  addDays(iso: IsoDate, days: number): IsoDate
  addMonths(iso: IsoDate, months: number): IsoDate
}

export function demoCalendar(today: IsoDate): DemoCalendar {
  const currentPeriod = periodOf(today)
  const period = (offset: number): Period =>
    periodOf(addMonths(firstDayOfPeriod(currentPeriod), offset))
  return {
    today,
    currentPeriod,
    period,
    monthStart: (offset) => firstDayOfPeriod(period(offset)),
    dayOf: (offset, day) => {
      const target = addDays(firstDayOfPeriod(period(offset)), day - 1)
      const last = lastDayOfPeriod(period(offset))
      return target > last ? last : target
    },
    addDays,
    addMonths,
  }
}
