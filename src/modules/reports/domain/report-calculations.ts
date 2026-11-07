import {
  addMonths,
  daysBetween,
  firstDayOfPeriod,
  IsoDate,
  isValidIsoDate,
  isValidPeriod,
  lastDayOfPeriod,
  Period,
  periodOf,
} from '@/shared/dates/calendar-date'
import { addMoney, compareMoney, toMoneyString } from '@/shared/money'
import { InvalidReportRangeException } from './reports.exceptions'
import {
  CurrencyAmount,
  REPORT_CURRENCY_ORDER,
  ReportCurrency,
} from './reports'

const ZERO = toMoneyString('0')

/** Cuántos meses puede abarcar un reporte con rango (3 años). */
export const MAX_REPORT_MONTHS = 36
/** Meses del historial del dashboard. */
export const HISTORY_MONTHS = 6

export function asCurrency(value: string): ReportCurrency {
  return value === 'USD' ? 'USD' : 'ARS'
}

/**
 * Suma por moneda sin mezclar nunca pesos con dólares. Siempre en el mismo
 * orden (pesos primero) y sin las monedas que suman cero.
 */
export function sumByCurrency(
  items: { currency: string; amount: string }[],
): CurrencyAmount[] {
  const totals = new Map<ReportCurrency, string>()
  for (const { currency, amount } of items) {
    const key = asCurrency(currency)
    totals.set(key, toMoneyString(addMoney(totals.get(key) ?? ZERO, amount)))
  }
  return REPORT_CURRENCY_ORDER.flatMap((currency) => {
    const amount = totals.get(currency)
    return amount !== undefined && compareMoney(amount, ZERO) !== 0
      ? [{ currency, amount }]
      : []
  })
}

/** Los `count` meses que terminan en `period`, el más viejo primero. */
export function lastPeriods(period: Period, count: number): Period[] {
  const last = firstDayOfPeriod(period)
  return Array.from({ length: count }, (_, index) =>
    periodOf(addMonths(last, index - (count - 1))),
  )
}

/** Todos los meses entre dos períodos, inclusive. */
export function periodsBetween(from: Period, to: Period): Period[] {
  const result: Period[] = []
  for (
    let current = from;
    current <= to;
    current = periodOf(addMonths(firstDayOfPeriod(current), 1))
  ) {
    result.push(current)
  }
  return result
}

export interface ReportRange {
  fromPeriod: Period
  toPeriod: Period
  fromDate: IsoDate
  toDate: IsoDate
}

function toBoundary(value: string, edge: 'from' | 'to'): [Period, IsoDate] {
  if (isValidPeriod(value)) {
    return [
      value,
      edge === 'from' ? firstDayOfPeriod(value) : lastDayOfPeriod(value),
    ]
  }
  if (isValidIsoDate(value)) return [periodOf(value), value]
  throw new InvalidReportRangeException(
    `"${value}" no es un mes (AAAA-MM) ni una fecha (AAAA-MM-DD)`,
  )
}

/**
 * Resuelve `from` y `to` (mes `AAAA-MM` o día `AAAA-MM-DD`). Sin rango, los
 * últimos 6 meses hasta el mes de `today`. Un mes en `from` es su primer día;
 * en `to`, el último (D-117).
 */
export function resolveRange(
  from: string | undefined,
  to: string | undefined,
  today: IsoDate,
): ReportRange {
  const [toPeriod, toDate] = toBoundary(to ?? periodOf(today), 'to')
  const [fromPeriod, fromDate] = toBoundary(
    from ?? lastPeriods(toPeriod, HISTORY_MONTHS)[0],
    'from',
  )
  if (fromDate > toDate) {
    throw new InvalidReportRangeException(
      'La fecha desde no puede ser posterior a la fecha hasta',
    )
  }
  if (periodsBetween(fromPeriod, toPeriod).length > MAX_REPORT_MONTHS) {
    throw new InvalidReportRangeException(
      `El rango no puede abarcar más de ${MAX_REPORT_MONTHS} meses`,
    )
  }
  return { fromPeriod, toPeriod, fromDate, toDate }
}

/**
 * Días que una propiedad lleva sin alquilarse: desde el fin del último
 * contrato (la rescisión si la hubo) o, si nunca tuvo uno, desde el alta.
 */
export function daysVacant(
  contractEnds: IsoDate[],
  createdAt: IsoDate,
  today: IsoDate,
): number {
  const since =
    contractEnds.length > 0
      ? contractEnds.reduce((latest, end) => (end > latest ? end : latest))
      : createdAt
  return Math.max(0, daysBetween(since, today))
}
