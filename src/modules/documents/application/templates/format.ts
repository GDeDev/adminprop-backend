import { IsoDate, Period } from '@/shared/dates/calendar-date'
import { toDecimal } from '@/shared/money'
import { DocumentCurrency } from '../../domain/document'

/**
 * Formatos de los PDFs, en español rioplatense. Sin `Intl` ni `number`: los
 * montos son strings decimales y se formatean por texto, así nunca pierden un
 * centavo.
 */

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

const SYMBOL: Record<DocumentCurrency, string> = { ARS: '$', USD: 'US$' }

/** `1234567.5` → `1.234.567,50`. */
export function formatAmount(amount: string): string {
  const fixed = toDecimal(amount).toFixed(2)
  const negative = fixed.startsWith('-')
  const [integer, decimals] = (negative ? fixed.slice(1) : fixed).split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negative ? '-' : ''}${grouped},${decimals}`
}

/** `$ 1.234,50` o `US$ 1.234,50`; un negativo sale `-$ 1.234,50`. */
export function formatMoney(
  amount: string,
  currency: DocumentCurrency,
): string {
  const formatted = formatAmount(amount)
  return formatted.startsWith('-')
    ? `-${SYMBOL[currency]} ${formatted.slice(1)}`
    : `${SYMBOL[currency]} ${formatted}`
}

/** `2026-10-31` → `31/10/2026`. */
export function formatDate(date: IsoDate): string {
  const [year, month, day] = date.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

/** `2026-10` → `Octubre 2026`. */
export function formatPeriod(period: Period): string {
  const [year, month] = period.split('-')
  const name = MONTHS[Number(month) - 1] ?? month
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`
}

/** `2026-09, 2026-10` → `Septiembre 2026, Octubre 2026`. */
export function formatPeriods(periods: Period[]): string {
  return periods.map(formatPeriod).join(', ')
}

/** `R$`-less percentage: `5.00` → `5,00 %`. */
export function formatPercentage(value: string): string {
  return `${formatAmount(value)} %`
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

// ------------------------------------------------------------------- Textos

export const METHOD_LABEL: Record<string, string> = {
  TRANSFER: 'Transferencia',
  CASH: 'Efectivo',
  CREDIT: 'Saldo a favor',
  OTHER: 'Otro',
  DEPOSIT: 'Depósito en garantía',
}

export const RECEIVER_LABEL: Record<string, string> = {
  AGENCY: 'La inmobiliaria',
  OWNER: 'El propietario',
}

export const FEE_MODE_LABEL: Record<string, string> = {
  DEDUCTED: 'Se descuenta de la liquidación',
  OWNER_PAYS: 'Lo paga el propietario aparte',
  RENTER_PAYS_ON_BEHALF: 'Lo paga el inquilino por cuenta del propietario',
}

export const ADJUSTMENT_LABEL: Record<string, string> = {
  WITHHOLDING: 'Retención',
  OWNER_ADVANCE: 'Adelanto al propietario',
  OTHER_DEDUCTION: 'Otro descuento',
  OTHER_CREDIT: 'Otro crédito',
}

export const SEND_MODE_LABEL: Record<string, string> = {
  SUMMARY: 'Resumen',
  RECEIPTS: 'Comprobantes',
  BOTH: 'Resumen y comprobantes',
}

export const EXCHANGE_SOURCE_LABEL: Record<string, string> = {
  OFFICIAL: 'Oficial',
  MEP: 'MEP',
  OTHER: 'Otra',
}

export const DEPOSIT_RETURN_LABEL: Record<string, string> = {
  FIXED: 'Se devuelve el importe recibido',
  FOLLOWS_RENT: 'Se devuelve el equivalente al alquiler vigente al terminar',
  MANUAL: 'Se define al cerrar las cuentas del contrato',
}

export function label(dictionary: Record<string, string>, key: string): string {
  return dictionary[key] ?? key
}
