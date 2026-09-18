import Decimal from 'decimal.js'

/**
 * Helper único de dinero (spec Fase 1, sección 2.1).
 *
 * Todo cálculo de punitorios, honorarios y liquidaciones pasa por acá: nadie
 * reimplementa el redondeo en su módulo. Reglas:
 *
 * - Nunca `number`. Los montos entran como string (DTOs), como `Decimal` o como
 *   el `Prisma.Decimal` que devuelve una columna `NUMERIC(14,2)`.
 * - Cada operación devuelve el resultado ya redondeado a 2 decimales con
 *   `ROUND_HALF_UP`. Redondear en cada paso (y no sólo al final) es lo que hace
 *   un humano con una calculadora, y es lo que va a comparar Oppido contra su
 *   Excel: si redondeáramos sólo al final, los centavos no coincidirían.
 * - Hacia afuera (DTOs, base) se sale con `toMoneyString()`.
 */

/**
 * Constructor aislado: configurar el `Decimal` global afectaría a cualquier otra
 * librería que lo use. La precisión alta es para los pasos intermedios; el
 * redondeo a centavos lo hace cada función explícitamente.
 */
const MoneyDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
})

export type Money = Decimal

/**
 * Lo que se acepta como monto. `{ toString(): string }` cubre el
 * `Prisma.Decimal` sin acoplar este helper a Prisma.
 */
export type MoneyInput = string | Decimal | { toString(): string }

const CENTS = 2

/** Convierte a `Decimal` sin redondear. Rechaza `number` y valores no finitos. */
export function toDecimal(value: MoneyInput): Money {
  if (typeof value === 'number') {
    // El tipo ya lo impide; esto frena a quien llegue con un `any`.
    throw new TypeError(
      'Los montos no pueden ser number: usá string o Decimal para no perder centavos',
    )
  }

  // Por string y no con `instanceof`: un `Prisma.Decimal` o un `Decimal` de
  // otro `clone()` no son instancia de este constructor.
  const text = String(value)
  let decimal: Decimal
  try {
    decimal = new MoneyDecimal(text.trim())
  } catch {
    throw new TypeError(`Monto inválido: "${text}"`)
  }

  if (!decimal.isFinite()) throw new TypeError(`Monto inválido: "${text}"`)
  return decimal
}

/** Redondea a centavos con `ROUND_HALF_UP` (1.005 → 1.01, -1.005 → -1.01). */
export function roundMoney(value: MoneyInput): Money {
  return toDecimal(value).toDecimalPlaces(CENTS, Decimal.ROUND_HALF_UP)
}

export function addMoney(...values: MoneyInput[]): Money {
  const total = values.reduce<Decimal>(
    (sum, value) => sum.plus(toDecimal(value)),
    new MoneyDecimal(0),
  )
  return roundMoney(total)
}

export function subtractMoney(
  minuend: MoneyInput,
  subtrahend: MoneyInput,
): Money {
  return roundMoney(toDecimal(minuend).minus(toDecimal(subtrahend)))
}

/** Multiplica un monto por un factor (ej. días de atraso). */
export function multiplyMoney(amount: MoneyInput, factor: MoneyInput): Money {
  return roundMoney(toDecimal(amount).times(toDecimal(factor)))
}

/**
 * Porcentaje de un monto. `percentage` va en puntos, no en fracción:
 * `percentageOf('150333.33', '5')` es el 5%, no el 500%.
 */
export function percentageOf(
  amount: MoneyInput,
  percentage: MoneyInput,
): Money {
  return roundMoney(
    toDecimal(amount).times(toDecimal(percentage)).dividedBy(100),
  )
}

/** -1, 0 o 1, comparando por valor (no por representación: "1.50" == "1.5"). */
export function compareMoney(a: MoneyInput, b: MoneyInput): -1 | 0 | 1 {
  return toDecimal(a).comparedTo(toDecimal(b)) as -1 | 0 | 1
}

/** Forma canónica para DTOs y para persistir: siempre 2 decimales, sin separadores. */
export function toMoneyString(value: MoneyInput): string {
  return roundMoney(value).toFixed(CENTS)
}

const CURRENCY_SYMBOL: Record<string, string> = {
  ARS: '$',
  USD: 'US$',
}

/**
 * Formato para mostrar en PDFs y emails, estilo argentino: `$ 150.333,33`.
 *
 * No usa `Intl.NumberFormat` porque convierte a `number`: con montos grandes
 * (una columna NUMERIC(14,2) llega a 12 dígitos enteros) se pierden centavos.
 */
export function formatMoney(value: MoneyInput, currency = 'ARS'): string {
  const [integerPart, decimalPart] = toMoneyString(value).split('.')
  const negative = integerPart.startsWith('-')
  const digits = negative ? integerPart.slice(1) : integerPart
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const symbol = CURRENCY_SYMBOL[currency] ?? currency

  return `${negative ? '-' : ''}${symbol} ${grouped},${decimalPart}`
}
