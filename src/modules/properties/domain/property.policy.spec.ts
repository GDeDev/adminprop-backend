import { PropertyStatus } from './property'
import {
  InvalidStatusTransitionException,
  PropertyHasActiveContractException,
  PropertyHasContractHistoryException,
  TooManyPhotosException,
} from './property.exceptions'
import { PropertyPolicy } from './property.policy'

const { AVAILABLE, RENTED, MAINTENANCE } = PropertyStatus

describe('PropertyPolicy', () => {
  it('normaliza la dirección y las notas', () => {
    expect(PropertyPolicy.normalizeAddress('  Av.  Corrientes   1234 ')).toBe(
      'Av. Corrientes 1234',
    )
    expect(PropertyPolicy.normalizeNotes('   ')).toBeNull()
    expect(PropertyPolicy.normalizeNotes(' Llave en portería ')).toBe(
      'Llave en portería',
    )
  })

  describe('cambio manual de estado', () => {
    it.each([
      [AVAILABLE, RENTED],
      [AVAILABLE, MAINTENANCE],
      [RENTED, MAINTENANCE],
      [RENTED, AVAILABLE],
      [MAINTENANCE, AVAILABLE],
    ])('sin contrato activo permite %s → %s', (from, to) => {
      expect(() =>
        PropertyPolicy.assertCanChangeStatus(from, to, false),
      ).not.toThrow()
    })

    it('de mantenimiento a alquilada no: se llega con un contrato', () => {
      expect(() =>
        PropertyPolicy.assertCanChangeStatus(MAINTENANCE, RENTED, false),
      ).toThrow(InvalidStatusTransitionException)
    })

    it('alquilada con contrato activo no pasa a disponible a mano (409)', () => {
      expect(() =>
        PropertyPolicy.assertCanChangeStatus(RENTED, AVAILABLE, true),
      ).toThrow(PropertyHasActiveContractException)
    })

    it('con contrato activo, igual se puede mandar a mantenimiento', () => {
      expect(() =>
        PropertyPolicy.assertCanChangeStatus(RENTED, MAINTENANCE, true),
      ).not.toThrow()
    })

    it('al mismo estado es un no-op', () => {
      expect(() =>
        PropertyPolicy.assertCanChangeStatus(MAINTENANCE, MAINTENANCE, true),
      ).not.toThrow()
    })
  })

  describe('fotos', () => {
    it('hasta 20 en total', () => {
      expect(() => PropertyPolicy.assertCanAddPhotos(19, 1)).not.toThrow()
      expect(() => PropertyPolicy.assertCanAddPhotos(20, 1)).toThrow(
        TooManyPhotosException,
      )
      expect(() => PropertyPolicy.assertCanAddPhotos(0, 21)).toThrow(
        TooManyPhotosException,
      )
    })
  })

  it('con historial de contratos no se puede borrar', () => {
    expect(() => PropertyPolicy.assertCanDelete(false)).not.toThrow()
    expect(() => PropertyPolicy.assertCanDelete(true)).toThrow(
      PropertyHasContractHistoryException,
    )
  })
})
