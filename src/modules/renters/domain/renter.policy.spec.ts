import {
  GuarantorDetailRequiredException,
  InvalidGuarantorNationalIdException,
} from './guarantor.exceptions'
import { GuarantorPolicy } from './guarantor.policy'
import {
  InvalidMoveInDateException,
  InvalidRenterNationalIdException,
} from './renter.exceptions'
import { RenterPolicy } from './renter.policy'

describe('RenterPolicy', () => {
  describe('normalizeNationalId', () => {
    it('saca puntos, guiones y espacios', () => {
      expect(RenterPolicy.normalizeNationalId('20.123.456')).toBe('20123456')
      expect(RenterPolicy.normalizeNationalId('20-12345678-9')).toBe(
        '20123456789',
      )
    })

    it.each(['123456', '123456789012', '20A23456', ''])(
      'rechaza "%s" con la excepción de inquilinos',
      (value) => {
        expect(() => RenterPolicy.normalizeNationalId(value)).toThrow(
          InvalidRenterNationalIdException,
        )
      },
    )
  })

  describe('normalizeMoveInDate', () => {
    it('acepta una fecha AAAA-MM-DD y vacío es null', () => {
      expect(RenterPolicy.normalizeMoveInDate(' 2026-03-01 ')).toBe(
        '2026-03-01',
      )
      expect(RenterPolicy.normalizeMoveInDate('')).toBeNull()
      expect(RenterPolicy.normalizeMoveInDate(null)).toBeNull()
      expect(RenterPolicy.normalizeMoveInDate(undefined)).toBeNull()
    })

    it.each(['2026-02-30', '2026-13-01', '01/03/2026', '2026-3-1'])(
      'rechaza "%s": no es una fecha del calendario',
      (value) => {
        expect(() => RenterPolicy.normalizeMoveInDate(value)).toThrow(
          InvalidMoveInDateException,
        )
      },
    )

    it('acepta el 29 de febrero sólo en año bisiesto', () => {
      expect(RenterPolicy.normalizeMoveInDate('2024-02-29')).toBe('2024-02-29')
      expect(() => RenterPolicy.normalizeMoveInDate('2026-02-29')).toThrow(
        InvalidMoveInDateException,
      )
    })
  })
})

describe('GuarantorPolicy', () => {
  it('normalizeNationalId rechaza con la excepción de garantes', () => {
    expect(GuarantorPolicy.normalizeNationalId('27.999.888')).toBe('27999888')
    expect(() => GuarantorPolicy.normalizeNationalId('123')).toThrow(
      InvalidGuarantorNationalIdException,
    )
  })

  describe('normalizeGuaranteeDetail (spec 4 y 6)', () => {
    it('recorta los bordes y conserva los saltos de línea', () => {
      expect(
        GuarantorPolicy.normalizeGuaranteeDetail(
          '  Calle 7 123, La Plata\nMatrícula 1234  ',
        ),
      ).toBe('Calle 7 123, La Plata\nMatrícula 1234')
    })

    it.each(['', '   ', null, undefined])(
      'un detalle vacío (%s) es un error',
      (value) => {
        expect(() => GuarantorPolicy.normalizeGuaranteeDetail(value)).toThrow(
          GuarantorDetailRequiredException,
        )
      },
    )
  })
})
