import { OwnerPolicy } from '@/modules/owners/domain/owner.policy'
import { cbuFor, cuitFor, demoDni, isValidCuit } from './demo-identifiers'

describe('identificadores ficticios de demo', () => {
  it('el CBU generado pasa la validación real del módulo de propietarios', () => {
    for (const account of ['0000000000001', '1234567890123', '9876543210987']) {
      expect(OwnerPolicy.isValidCbu(cbuFor(account))).toBe(true)
    }
  })

  it('el CBU usa la entidad y la sucursal inexistentes 999 / 9999', () => {
    expect(cbuFor('0000000000001').startsWith('9999999')).toBe(true)
  })

  it('rechaza un CBU con un dígito cambiado', () => {
    const cbu = cbuFor('1234567890123')
    const tampered = `${cbu.slice(0, 10)}${(Number(cbu[10]) + 1) % 10}${cbu.slice(11)}`
    expect(OwnerPolicy.isValidCbu(tampered)).toBe(false)
  })

  it('el CUIT generado tiene el dígito verificador correcto', () => {
    // Caso conocido: 20-12345678-6 es un CUIT válido de ejemplo.
    expect(cuitFor('20', '12345678')).toBe('20123456786')
    expect(isValidCuit('20123456786')).toBe(true)
    expect(isValidCuit('20123456787')).toBe(false)
  })

  it('los DNI de demo caen en un rango que no se emite y son de 8 dígitos', () => {
    const dni = demoDni(1, 7)
    expect(dni).toMatch(/^\d{8}$/)
    expect(Number(dni)).toBeGreaterThanOrEqual(90_000_000)
    expect(demoDni(1, 7)).not.toBe(demoDni(2, 7))
  })
})
