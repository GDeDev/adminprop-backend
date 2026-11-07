import { toDecimal } from '@/shared/money'
import {
  InvalidIndexPeriodException,
  InvalidIndexValueException,
} from './index-value.exceptions'

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/

/** Reglas puras de los índices: sin NestJS ni Prisma. */
export const IndexValuePolicy = {
  /** `AAAA-MM`, con un mes del calendario. */
  normalizePeriod(value: string): string {
    const trimmed = value.trim()
    if (!PERIOD.test(trimmed)) throw new InvalidIndexPeriodException()
    return trimmed
  },

  /**
   * Un índice es un número positivo. Se guarda tal como vino, con hasta 6
   * decimales: el redondeo a centavos es del alquiler, no del índice.
   */
  normalizeValue(value: string): string {
    const decimal = toDecimal(value)
    if (decimal.lessThanOrEqualTo(0)) throw new InvalidIndexValueException()
    return decimal.toFixed(6)
  },
}
