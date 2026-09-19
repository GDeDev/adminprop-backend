import {
  ExampleItemInvalidPriceException,
  InvalidPriceIncreaseException,
} from './example-item.exceptions'
import { ExampleItemPolicy } from './example-item.policy'

/**
 * Tests del Domain Service: funciones puras, sin mocks (spec Fase 1, 10).
 */
describe('ExampleItemPolicy', () => {
  describe('applyIncrease', () => {
    it('redondea ROUND_HALF_UP a centavos: 5% de 150.333,33 (caso borde de la spec)', () => {
      // 5% de 150333.33 = 7516.6665 → 7516.67; total 157850.00.
      expect(ExampleItemPolicy.applyIncrease('150333.33', '5')).toBe(
        '157850.00',
      )
    })

    it('acepta porcentajes con decimales', () => {
      expect(ExampleItemPolicy.applyIncrease('1000.00', '7.5')).toBe('1075.00')
    })

    it('siempre devuelve dos decimales', () => {
      expect(ExampleItemPolicy.applyIncrease('100', '10')).toBe('110.00')
    })

    it.each(['0', '-5', '100.01'])('rechaza un aumento de %s%%', (pct) => {
      expect(() => ExampleItemPolicy.applyIncrease('100', pct)).toThrow(
        InvalidPriceIncreaseException,
      )
    })

    it('acepta el máximo, 100%', () => {
      expect(ExampleItemPolicy.applyIncrease('100', '100')).toBe('200.00')
    })
  })

  describe('assertValidPrice', () => {
    it.each(['0', '0.00', '-1'])('rechaza %s', (price) => {
      expect(() => ExampleItemPolicy.assertValidPrice(price)).toThrow(
        ExampleItemInvalidPriceException,
      )
    })

    it('acepta un centavo', () => {
      expect(() => ExampleItemPolicy.assertValidPrice('0.01')).not.toThrow()
    })
  })

  describe('normalizeName', () => {
    it('saca espacios de más', () => {
      expect(ExampleItemPolicy.normalizeName('  Casa   de  campo ')).toBe(
        'Casa de campo',
      )
    })
  })
})
