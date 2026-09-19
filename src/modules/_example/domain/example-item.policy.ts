import {
  addMoney,
  compareMoney,
  percentageOf,
  toMoneyString,
} from '@/shared/money'
import {
  ExampleItemInvalidPriceException,
  InvalidPriceIncreaseException,
} from './example-item.exceptions'

/**
 * Domain Service del módulo de referencia: reglas de negocio puras.
 *
 * Sin NestJS, sin Prisma, sin HTTP: se testea con datos y nada más. Los
 * handlers lo invocan; él no sabe que existen (spec Fase 1, sección 6).
 */
export const ExampleItemPolicy = {
  /** El nombre se guarda sin espacios de más: " Casa  1 " y "Casa 1" son el mismo. */
  normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ')
  },

  /** Regla trivial pero real: un precio tiene que ser positivo. */
  assertValidPrice(price: string): void {
    if (compareMoney(price, '0') <= 0) {
      throw new ExampleItemInvalidPriceException()
    }
  },

  /** Un aumento va de más de 0% a 100%. */
  assertValidIncrease(percentage: string): void {
    if (
      compareMoney(percentage, '0') <= 0 ||
      compareMoney(percentage, '100') > 0
    ) {
      throw new InvalidPriceIncreaseException()
    }
  },

  /**
   * Precio con un aumento porcentual aplicado, redondeado a centavos con
   * ROUND_HALF_UP por el helper de dinero (nunca a mano).
   *
   * `applyIncrease('150333.33', '5')` → `'157850.00'`
   */
  applyIncrease(price: string, percentage: string): string {
    ExampleItemPolicy.assertValidIncrease(percentage)
    return toMoneyString(addMoney(price, percentageOf(price, percentage)))
  },
}
