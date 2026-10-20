/**
 * Fechas de calendario (sin hora ni zona), como string `AAAA-MM-DD`.
 *
 * Un contrato empieza "el 1 de marzo", no a una hora de un huso: tratarlo
 * como `Date` corre la fecha un día según dónde esté el servidor. Por eso el
 * dominio trabaja con strings ISO y esta aritmética, que opera en UTC a
 * propósito y sólo para contar días y meses. Como el formato es `AAAA-MM-DD`,
 * comparar dos fechas es comparar los strings.
 */

export type IsoDate = string

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `2026-02-30` pasa la expresión regular pero no es una fecha. */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [, year, month, day] = match
  const date = new Date(Date.UTC(+year, +month - 1, +day))
  return (
    date.getUTCFullYear() === +year &&
    date.getUTCMonth() === +month - 1 &&
    date.getUTCDate() === +day
  )
}

function toUtc(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10)
}

/** Hoy, en UTC. Para reglas de negocio que miran "la fecha de hoy". */
export function todayIso(): IsoDate {
  return toIsoDate(new Date())
}

/** `AAAA-MM` de una fecha: el período de un índice. */
export function periodOf(iso: IsoDate): string {
  return iso.slice(0, 7)
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = toUtc(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return toIsoDate(date)
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/**
 * Suma meses conservando el día; si el mes destino es más corto, se queda
 * en su último día (31 de enero + 1 mes = 28 de febrero).
 */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const date = toUtc(iso)
  const day = date.getUTCDate()
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months
  const year = Math.floor(total / 12)
  const monthIndex = total - year * 12
  return toIsoDate(
    new Date(
      Date.UTC(year, monthIndex, Math.min(day, daysInMonth(year, monthIndex))),
    ),
  )
}

/** `to - from` en días. Negativo si `to` es anterior. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round(
    (toUtc(to).getTime() - toUtc(from).getTime()) / (24 * 60 * 60 * 1000),
  )
}

/**
 * Cuántos meses enteros caben entre las dos fechas: el mayor `m` tal que
 * `addMonths(from, m) <= to`. Cero si `to` es anterior a `from`.
 */
export function fullMonthsBetween(from: IsoDate, to: IsoDate): number {
  if (to < from) return 0
  const a = toUtc(from)
  const b = toUtc(to)
  let months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth())
  // El mes calculado puede pasarse por el día (del 31 al 30 del mes que
  // viene no es un mes entero): se corrige una vez.
  if (addMonths(from, months) > to) months -= 1
  return Math.max(0, months)
}

export function minIsoDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b
}
