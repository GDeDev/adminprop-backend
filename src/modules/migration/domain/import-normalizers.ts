import { isValidIsoDate, IsoDate } from '@/shared/dates/calendar-date'
import { toMoneyString } from '@/shared/money'

/** Minúsculas, sin acentos ni espacios de más: la forma en que se comparan nombres. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

const STREET_PREFIXES = /^(calle|avenida|av|avda|pasaje|pje|diagonal|diag)\b/

/**
 * "Av. Santa Fe  1234" y "avenida santa fe 1234" son la misma dirección: sin
 * acentos, sin puntuación y sin el prefijo de calle (rediseño 2.1).
 */
export function normalizeAddressKey(address: string): string {
  const base = normalizeText(address)
    .replace(/[.,;°º#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return base.replace(STREET_PREFIXES, '').trim()
}

/** Ruta de ubicación en una sola clave comparable. */
export function normalizePathKey(path: string[]): string {
  return path.map(normalizeText).join('>')
}

/** "Palermo > Capital" → ['Palermo', 'Capital']. */
export function splitPath(value: string): string[] {
  return value
    .split(/[>|]/)
    .map((segment) => segment.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}

export type CellValue = string | number | boolean | Date | null | undefined

/** Texto de una celda: números y fechas se pasan a string, vacío es null. */
export function cellText(value: CellValue): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = String(value).trim().replace(/\s+/g, ' ')
  return text === '' ? null : text
}

/** Notas: conservan los saltos de línea. */
export function cellNotes(value: CellValue): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

/**
 * Monto de una celda. Acepta `1234.56`, `1.234,56`, `1234,56`, `$ 150.000`
 * y el número que trae Excel. Devuelve el monto canónico (2 decimales) o
 * `undefined` si no es un monto; null si la celda estaba vacía.
 */
export function parseMoney(value: CellValue): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    // El número que entrega Excel ya es el valor tipeado: se pasa por su texto.
    return toMoneyString(String(value))
  }
  if (typeof value !== 'string') return undefined

  let text = value.replace(/[\s$]|ARS|USD|US\$/gi, '')
  if (text === '') return null
  if (!/^-?[\d.,]+$/.test(text)) return undefined

  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    // El último separador es el decimal; el otro agrupa miles.
    const decimal = lastDot > lastComma ? '.' : ','
    const thousands = decimal === '.' ? ',' : '.'
    text = text.split(thousands).join('').replace(decimal, '.')
  } else if (lastComma >= 0) {
    if ((text.match(/,/g) ?? []).length > 1) {
      text = text.split(',').join('')
    } else {
      text = text.replace(',', '.')
    }
  } else if (lastDot >= 0) {
    // "150.000" son miles; "150.5" es un decimal.
    if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.split('.').join('')
  }

  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined
  return toMoneyString(text)
}

/** Porcentaje (0-100) de una celda, con la misma tolerancia de formato que el dinero. */
export function parsePercentage(value: CellValue): string | null | undefined {
  const text = typeof value === 'string' ? value.replace('%', '') : value
  const parsed = parseMoney(text)
  if (parsed === null || parsed === undefined) return parsed
  const number = Number(parsed)
  return number < 0 || number > 100 ? undefined : parsed
}

/**
 * Fecha de una celda: la de Excel (un `Date` en UTC), `dd/mm/aaaa`,
 * `d/m/aa` o `aaaa-mm-dd`. Null si estaba vacía, `undefined` si no es una
 * fecha real.
 */
export function parseDate(value: CellValue): IsoDate | null | undefined {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? undefined
      : value.toISOString().slice(0, 10)
  }
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '') return null

  let iso: string | null = null
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text)
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
    iso = `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  } else if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    iso = text.slice(0, 10)
  }
  return iso && isValidIsoDate(iso) ? iso : undefined
}

export function parseInteger(value: CellValue): number | null | undefined {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(String(value))
  return Number.isInteger(number) ? number : undefined
}

/** Un valor del Excel en español (o el código en inglés) a su enum. */
export function lookup<T extends string>(
  value: CellValue,
  table: Record<string, T>,
): T | null | undefined {
  const text = cellText(value)
  if (text === null) return null
  const key = normalizeText(text)
  return Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined
}

export const CURRENCIES: Record<string, 'ARS' | 'USD'> = {
  ars: 'ARS',
  peso: 'ARS',
  pesos: 'ARS',
  $: 'ARS',
  usd: 'USD',
  dolar: 'USD',
  dolares: 'USD',
  u$s: 'USD',
  us$: 'USD',
}

export const UPDATE_TYPES: Record<string, 'ICL' | 'IPC' | 'FIXED' | 'OTHER'> = {
  icl: 'ICL',
  ipc: 'IPC',
  fijo: 'FIXED',
  fixed: 'FIXED',
  otro: 'OTHER',
  other: 'OTHER',
  manual: 'OTHER',
}

export const UPDATE_FREQUENCIES: Record<
  string,
  'MONTHLY' | 'QUARTERLY' | 'FOUR_MONTHLY' | 'SEMIANNUAL' | 'ANNUAL'
> = {
  mensual: 'MONTHLY',
  monthly: 'MONTHLY',
  trimestral: 'QUARTERLY',
  quarterly: 'QUARTERLY',
  cuatrimestral: 'FOUR_MONTHLY',
  four_monthly: 'FOUR_MONTHLY',
  semestral: 'SEMIANNUAL',
  semiannual: 'SEMIANNUAL',
  anual: 'ANNUAL',
  annual: 'ANNUAL',
}

export const COLLECTION_MODES: Record<string, 'AGENCY' | 'OWNER_DIRECT'> = {
  inmobiliaria: 'AGENCY',
  agency: 'AGENCY',
  propietario: 'OWNER_DIRECT',
  directo: 'OWNER_DIRECT',
  owner_direct: 'OWNER_DIRECT',
}

export const GUARANTEE_TYPES: Record<string, 'PROPERTY' | 'PAYSLIPS'> = {
  inmueble: 'PROPERTY',
  propiedad: 'PROPERTY',
  property: 'PROPERTY',
  'recibos de sueldo': 'PAYSLIPS',
  recibos: 'PAYSLIPS',
  sueldo: 'PAYSLIPS',
  payslips: 'PAYSLIPS',
}
