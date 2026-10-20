import {
  InvalidIndexPeriodException,
  InvalidIndexValueException,
} from './index-value.exceptions'
import { IndexValuePolicy } from './index-value.policy'

describe('IndexValuePolicy', () => {
  describe('normalizePeriod', () => {
    it('acepta AAAA-MM y recorta los bordes', () => {
      expect(IndexValuePolicy.normalizePeriod(' 2026-03 ')).toBe('2026-03')
    })

    it.each(['2026-13', '2026-3', '03-2026', '2026-03-01', ''])(
      'rechaza "%s"',
      (value) => {
        expect(() => IndexValuePolicy.normalizePeriod(value)).toThrow(
          InvalidIndexPeriodException,
        )
      },
    )
  })

  describe('normalizeValue', () => {
    it('guarda hasta 6 decimales sin redondear a centavos', () => {
      expect(IndexValuePolicy.normalizeValue('1.234567')).toBe('1.234567')
      expect(IndexValuePolicy.normalizeValue('1500')).toBe('1500.000000')
    })

    it('rechaza cero y negativos', () => {
      expect(() => IndexValuePolicy.normalizeValue('0')).toThrow(
        InvalidIndexValueException,
      )
      expect(() => IndexValuePolicy.normalizeValue('-1')).toThrow(
        InvalidIndexValueException,
      )
    })
  })
})
