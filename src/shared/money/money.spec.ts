import { Prisma } from '@prisma/client'
import Decimal from 'decimal.js'

import {
  addMoney,
  compareMoney,
  formatMoney,
  multiplyMoney,
  percentageOf,
  roundMoney,
  subtractMoney,
  toDecimal,
  toMoneyString,
} from './money'

describe('money', () => {
  describe('redondeo ROUND_HALF_UP a 2 decimales', () => {
    it.each([
      ['1.005', '1.01'],
      ['1.004', '1.00'],
      ['0.005', '0.01'],
      ['2.675', '2.68'],
      ['-1.005', '-1.01'],
      ['150333.335', '150333.34'],
      ['10', '10.00'],
    ])('%s → %s', (input, expected) => {
      expect(toMoneyString(roundMoney(input))).toBe(expected)
    })

    it('redondea el 5% de 150.333,33 (caso borde de la spec) a 7516.67', () => {
      // 150333.33 * 0.05 = 7516.6665 → sube por el 5 en el tercer decimal
      expect(toMoneyString(percentageOf('150333.33', '5'))).toBe('7516.67')
    })
  })

  describe('aritmética sin errores de punto flotante', () => {
    it('0.1 + 0.2 da exactamente 0.30', () => {
      expect(toMoneyString(addMoney('0.1', '0.2'))).toBe('0.30')
    })

    it('suma muchos montos sin acumular error', () => {
      const amounts = Array.from({ length: 1000 }, () => '0.10')
      expect(toMoneyString(addMoney(...amounts))).toBe('100.00')
    })

    it('addMoney sin argumentos da cero', () => {
      expect(toMoneyString(addMoney())).toBe('0.00')
    })

    it('resta', () => {
      expect(toMoneyString(subtractMoney('150000.00', '7500.01'))).toBe(
        '142499.99',
      )
    })

    it('multiplica por días de atraso y redondea', () => {
      // 5% diario de 100.333,33 = 5016.6665 → 5016.67 por día
      const daily = percentageOf('100333.33', '5')
      expect(toMoneyString(multiplyMoney(daily, '3'))).toBe('15050.01')
    })

    it('el porcentaje va en puntos, no en fracción', () => {
      expect(toMoneyString(percentageOf('1000', '3'))).toBe('30.00')
      expect(toMoneyString(percentageOf('1000', '0.5'))).toBe('5.00')
    })
  })

  describe('entradas', () => {
    it('acepta el Prisma.Decimal que devuelve una columna NUMERIC', () => {
      expect(toMoneyString(new Prisma.Decimal('1234.5'))).toBe('1234.50')
    })

    it('acepta un Decimal de decimal.js', () => {
      expect(toMoneyString(new Decimal('99.999'))).toBe('100.00')
    })

    it('rechaza number, aunque llegue por un any', () => {
      expect(() => toDecimal(0.1 as any)).toThrow(TypeError)
    })

    it.each(['', 'abc', '1,50', 'Infinity', 'NaN'])(
      'rechaza el valor inválido "%s"',
      (value) => {
        expect(() => toDecimal(value)).toThrow(TypeError)
      },
    )
  })

  describe('compareMoney', () => {
    it('compara por valor, no por representación', () => {
      expect(compareMoney('1.50', '1.5')).toBe(0)
      expect(compareMoney('1.49', '1.5')).toBe(-1)
      expect(compareMoney('100', '99.99')).toBe(1)
    })
  })

  describe('formatMoney', () => {
    it.each([
      ['150333.33', 'ARS', '$ 150.333,33'],
      ['0.5', 'ARS', '$ 0,50'],
      ['999', 'ARS', '$ 999,00'],
      ['1200', 'USD', 'US$ 1.200,00'],
      ['-7516.6665', 'ARS', '-$ 7.516,67'],
      // 12 dígitos enteros: con Intl.NumberFormat (number) se perderían centavos
      ['999999999999.99', 'ARS', '$ 999.999.999.999,99'],
    ])('%s %s → %s', (value, currency, expected) => {
      expect(formatMoney(value, currency)).toBe(expected)
    })

    it('usa ARS por defecto', () => {
      expect(formatMoney('10')).toBe('$ 10,00')
    })
  })
})
