import { Location, LocationLevel } from './location'
import { InvalidLocationParentException } from './master-data.exceptions'
import { MasterDataPolicy } from './master-data.policy'

function location(
  id: string,
  level: LocationLevel,
  name: string,
  parentId: string | null = null,
): Location {
  return {
    id,
    level,
    name,
    parentId,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  }
}

const argentina = location('ar', LocationLevel.COUNTRY, 'Argentina')
const buenosAires = location('ba', LocationLevel.PROVINCE, 'Buenos Aires', 'ar')
const laPlata = location('lp', LocationLevel.CITY, 'La Plata', 'ba')
const tolosa = location('to', LocationLevel.NEIGHBORHOOD, 'Tolosa', 'lp')

describe('MasterDataPolicy', () => {
  it('normaliza los espacios del nombre', () => {
    expect(MasterDataPolicy.normalizeName('  Villa   Crespo ')).toBe(
      'Villa Crespo',
    )
  })

  describe('assertValidParent', () => {
    it('un país va sin padre', () => {
      expect(() =>
        MasterDataPolicy.assertValidParent(LocationLevel.COUNTRY, null),
      ).not.toThrow()
    })

    it('un país no puede estar dentro de otra ubicación', () => {
      expect(() =>
        MasterDataPolicy.assertValidParent(LocationLevel.COUNTRY, argentina),
      ).toThrow(InvalidLocationParentException)
    })

    it('un barrio sin padre no se puede crear', () => {
      expect(() =>
        MasterDataPolicy.assertValidParent(LocationLevel.NEIGHBORHOOD, null),
      ).toThrow(InvalidLocationParentException)
    })

    it('acepta un padre de un nivel más general', () => {
      expect(() =>
        MasterDataPolicy.assertValidParent(LocationLevel.NEIGHBORHOOD, laPlata),
      ).not.toThrow()
    })

    it('permite saltear niveles: una localidad directo en un país', () => {
      // Los datos de Tokko no siempre traen los cuatro niveles.
      expect(() =>
        MasterDataPolicy.assertValidParent(LocationLevel.CITY, argentina),
      ).not.toThrow()
    })

    it('rechaza un padre del mismo nivel o más específico', () => {
      expect(() =>
        MasterDataPolicy.assertValidParent(LocationLevel.CITY, laPlata),
      ).toThrow('Una localidad no puede estar dentro de una localidad')
      expect(() =>
        MasterDataPolicy.assertValidParent(LocationLevel.PROVINCE, tolosa),
      ).toThrow(InvalidLocationParentException)
    })
  })

  describe('buildTree', () => {
    it('anida cada ubicación bajo su padre, en orden alfabético', () => {
      const quilmes = location('qu', LocationLevel.CITY, 'Quilmes', 'ba')

      const tree = MasterDataPolicy.buildTree([
        tolosa,
        quilmes,
        laPlata,
        buenosAires,
        argentina,
      ])

      expect(tree).toHaveLength(1)
      expect(tree[0].name).toBe('Argentina')
      const cities = tree[0].children[0].children
      expect(cities.map((c) => c.name)).toEqual(['La Plata', 'Quilmes'])
      expect(cities[0].children.map((c) => c.name)).toEqual(['Tolosa'])
    })

    it('un nodo cuyo padre no vino queda en la raíz, no se pierde', () => {
      const tree = MasterDataPolicy.buildTree([tolosa])

      expect(tree.map((n) => n.id)).toEqual(['to'])
    })
  })
})
