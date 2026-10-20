import {
  InvalidCbuException,
  InvalidNationalIdException,
} from './owner.exceptions'
import { OwnerPolicy } from './owner.policy'
import { appliesReducedFee } from './reduced-fee'

const VALID_CBU = '0110599552000000123456'

describe('OwnerPolicy', () => {
  describe('normalizeNationalId', () => {
    it('saca puntos, guiones y espacios', () => {
      expect(OwnerPolicy.normalizeNationalId('20.123.456')).toBe('20123456')
      expect(OwnerPolicy.normalizeNationalId('20-12345678-9')).toBe(
        '20123456789',
      )
    })

    it.each(['123456', '123456789012', '20A23456', ''])(
      'rechaza "%s"',
      (value) => {
        expect(() => OwnerPolicy.normalizeNationalId(value)).toThrow(
          InvalidNationalIdException,
        )
      },
    )
  })

  describe('isValidCbu', () => {
    it('acepta un CBU con los dos verificadores bien', () => {
      expect(OwnerPolicy.isValidCbu(VALID_CBU)).toBe(true)
      expect(OwnerPolicy.isValidCbu('2850590994000090418137')).toBe(true)
    })

    it('rechaza un dígito mal tipeado en cualquiera de los dos bloques', () => {
      expect(OwnerPolicy.isValidCbu('0110599452000000123456')).toBe(false)
      expect(OwnerPolicy.isValidCbu('0110599552000000123457')).toBe(false)
    })

    it('rechaza un largo distinto de 22 o letras', () => {
      expect(OwnerPolicy.isValidCbu(VALID_CBU.slice(1))).toBe(false)
      expect(OwnerPolicy.isValidCbu(`${VALID_CBU.slice(1)}A`)).toBe(false)
    })
  })

  describe('normalizeBankAccount', () => {
    it('limpia los campos y deja null los vacíos', () => {
      expect(
        OwnerPolicy.normalizeBankAccount({
          cbu: ` ${VALID_CBU} `,
          alias: ' Casa.Perez.Mp ',
          bankName: '',
          holder: '  Juan   Pérez ',
        }),
      ).toEqual({
        cbu: VALID_CBU,
        alias: 'casa.perez.mp',
        bankName: null,
        holder: 'Juan Pérez',
      })
    })

    it('frena un CBU con verificador inválido', () => {
      expect(() =>
        OwnerPolicy.normalizeBankAccount({
          cbu: '0110599552000000123457',
          alias: null,
          bankName: null,
          holder: null,
        }),
      ).toThrow(InvalidCbuException)
    })
  })
})

describe('appliesReducedFee (RN-07)', () => {
  it('aplica desde el umbral', () => {
    expect(appliesReducedFee(3, 3)).toBe(true)
    expect(appliesReducedFee(4, 3)).toBe(true)
  })

  it('no aplica por debajo', () => {
    expect(appliesReducedFee(2, 3)).toBe(false)
  })

  it('con umbral 0 la inmobiliaria no usa el beneficio: no aplica nunca', () => {
    expect(appliesReducedFee(0, 0)).toBe(false)
    expect(appliesReducedFee(10, 0)).toBe(false)
  })
})

describe('OwnerPolicy.searchKey', () => {
  it('saca acentos y mayúsculas, así "perez" encuentra "Pérez"', () => {
    expect(OwnerPolicy.searchKey('  José  PÉREZ Muñoz ')).toBe(
      'jose perez munoz',
    )
  })
})
