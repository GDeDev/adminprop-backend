import { LocationIndex, LocationNodeRef } from './location-index'

const NODES: LocationNodeRef[] = [
  { id: 'ar', name: 'Argentina', level: 'COUNTRY', parentId: null },
  { id: 'ba', name: 'Buenos Aires', level: 'PROVINCE', parentId: 'ar' },
  { id: 'lp', name: 'La Plata', level: 'CITY', parentId: 'ba' },
  { id: 'tol', name: 'Tolosa', level: 'NEIGHBORHOOD', parentId: 'lp' },
  { id: 'cf', name: 'Capital Federal', level: 'PROVINCE', parentId: 'ar' },
  { id: 'pal', name: 'Palermo', level: 'CITY', parentId: 'cf' },
  { id: 'cen', name: 'Centro', level: 'NEIGHBORHOOD', parentId: 'lp' },
  { id: 'cen2', name: 'Centro', level: 'NEIGHBORHOOD', parentId: 'pal' },
]

describe('LocationIndex', () => {
  const index = new LocationIndex(NODES)

  it('encuentra una ruta completa, con o sin el país y sin distinguir acentos', () => {
    expect(
      index.resolve(['Argentina', 'Buenos Aires', 'La Plata', 'Tolosa']),
    ).toEqual({
      kind: 'FOUND',
      id: 'tol',
      path: ['Buenos Aires', 'La Plata', 'Tolosa'],
      level: 'NEIGHBORHOOD',
    })
    expect(index.resolve(['buenos aires', 'la plata'])).toMatchObject({
      kind: 'FOUND',
      id: 'lp',
    })
  })

  it('un nombre suelto se resuelve si es único', () => {
    expect(index.resolve(['Tolosa'])).toMatchObject({
      kind: 'FOUND',
      id: 'tol',
    })
  })

  it('un nombre suelto repetido es ambiguo y uno inexistente no se puede ubicar', () => {
    expect(index.resolve(['Centro'])).toEqual({
      kind: 'AMBIGUOUS',
      name: 'Centro',
    })
    expect(index.resolve(['Villa Elisa'])).toEqual({
      kind: 'UNKNOWN_NAME',
      name: 'Villa Elisa',
    })
  })

  it('una ruta parcial se marca como nueva y cuenta sólo los nodos que faltan', () => {
    const path = ['Buenos Aires', 'La Plata', 'City Bell']
    expect(index.resolve(path)).toEqual({ kind: 'NEW', path })
    expect(index.missingNodeKeys(path)).toEqual([
      'buenos aires>la plata>city bell',
    ])
    expect(index.missingNodeKeys(['Córdoba', 'Capital'])).toEqual([
      'cordoba',
      'cordoba>capital',
    ])
    expect(index.missingNodeKeys(['Buenos Aires', 'La Plata'])).toEqual([])
  })

  it('rechaza rutas de más de tres niveles', () => {
    expect(index.resolve(['a', 'b', 'c', 'd'])).toEqual({ kind: 'TOO_DEEP' })
  })

  it('arma la ruta de un nodo sin el país', () => {
    expect(index.pathOf('tol')).toEqual(['Buenos Aires', 'La Plata', 'Tolosa'])
  })
})
