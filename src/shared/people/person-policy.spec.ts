import {
  fullNameOf,
  PersonPolicy,
  personSearchTerms,
  personSearchWhere,
} from './person-policy'

describe('PersonPolicy', () => {
  describe('parseNationalId', () => {
    it('saca puntos, guiones y espacios', () => {
      expect(PersonPolicy.parseNationalId('20.123.456')).toBe('20123456')
      expect(PersonPolicy.parseNationalId('20-12345678-9')).toBe('20123456789')
      expect(PersonPolicy.parseNationalId(' 20 123 456 ')).toBe('20123456')
    })

    it.each(['123456', '123456789012', '20A23456', ''])(
      'devuelve null para "%s"',
      (value) => {
        expect(PersonPolicy.parseNationalId(value)).toBeNull()
      },
    )
  })

  describe('clean y normalizeName', () => {
    it('recorta y colapsa espacios; vacío es null', () => {
      expect(PersonPolicy.clean('  Juan   Pérez ')).toBe('Juan Pérez')
      expect(PersonPolicy.clean('   ')).toBeNull()
      expect(PersonPolicy.clean(undefined)).toBeNull()
      expect(PersonPolicy.normalizeName('  María  José ')).toBe('María José')
    })
  })

  it('normalizeEmail pasa a minúsculas y vacío es null', () => {
    expect(PersonPolicy.normalizeEmail(' Juan@Correo.COM ')).toBe(
      'juan@correo.com',
    )
    expect(PersonPolicy.normalizeEmail('')).toBeNull()
  })

  it('normalizeNotes conserva los saltos de línea', () => {
    expect(PersonPolicy.normalizeNotes('  línea 1\nlínea 2  ')).toBe(
      'línea 1\nlínea 2',
    )
    expect(PersonPolicy.normalizeNotes('  ')).toBeNull()
  })

  it('searchKey saca acentos y mayúsculas, así "perez" encuentra "Pérez"', () => {
    expect(PersonPolicy.searchKey('  José  PÉREZ Muñoz ')).toBe(
      'jose perez munoz',
    )
  })

  it('fullNameOf junta nombre y apellido', () => {
    expect(fullNameOf({ firstName: 'Juan', lastName: 'Pérez' })).toBe(
      'Juan Pérez',
    )
  })
})

describe('búsqueda de personas', () => {
  it('cada palabra busca por nombre, y por DNI si son dígitos', () => {
    expect(personSearchTerms(' Pérez 20.123 ')).toEqual([
      { nameKey: 'perez', digits: null },
      { nameKey: '20.123', digits: '20123' },
    ])
  })

  it('sin texto no filtra', () => {
    expect(personSearchWhere(undefined)).toEqual({})
    expect(personSearchWhere('   ')).toEqual({})
  })

  it('arma un AND de ORs: todas las palabras tienen que aparecer', () => {
    expect(personSearchWhere('perez 27')).toEqual({
      AND: [
        { OR: [{ searchName: { contains: 'perez' } }] },
        {
          OR: [
            { searchName: { contains: '27' } },
            { nationalId: { contains: '27' } },
          ],
        },
      ],
    })
  })
})
