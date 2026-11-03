import { categoryOfPropertyType, normalizeAmenity } from './market-category'
import { MarketCategory } from './market'
import {
  buildZoneKey,
  buildZoneLabel,
  parentZoneKey,
  slugify,
  zoneSegments,
} from './zone-key'

describe('zona de mercado', () => {
  it('normaliza los nombres sin acentos ni signos', () => {
    expect(slugify('City Bell')).toBe('city-bell')
    expect(slugify('  Nuñez / Belgrano  ')).toBe('nunez-belgrano')
    expect(slugify('Ciudad Autónoma de Buenos Aires')).toBe(
      'ciudad-autonoma-de-buenos-aires',
    )
  })

  it('arma la clave de la jerarquía y dos inmobiliarias con los mismos nombres comparten zona', () => {
    expect(buildZoneKey(['Buenos Aires', 'La Plata', 'City Bell'])).toBe(
      'buenos-aires/la-plata/city-bell',
    )
    // Otra inmobiliaria, con otras mayúsculas y acentos: misma zona (A-61).
    expect(buildZoneKey(['BUENOS AIRES', 'la plata', 'City  Bell'])).toBe(
      'buenos-aires/la-plata/city-bell',
    )
  })

  it('sin nombres usables no hay zona', () => {
    expect(buildZoneKey([])).toBeNull()
    expect(buildZoneKey(['!!!', '  '])).toBeNull()
  })

  it('la zona padre es la que contiene a esta, y la más amplia no tiene', () => {
    expect(parentZoneKey('caba/palermo')).toBe('caba')
    expect(parentZoneKey('buenos-aires/la-plata/city-bell')).toBe(
      'buenos-aires/la-plata',
    )
    expect(parentZoneKey('caba')).toBeNull()
  })

  it('la etiqueta muestra el nombre más específico y el que lo contiene', () => {
    expect(buildZoneLabel(['CABA', 'Palermo'])).toBe('Palermo, CABA')
    expect(buildZoneLabel(['Buenos Aires', 'La Plata', 'City Bell'])).toBe(
      'City Bell, La Plata',
    )
    expect(buildZoneLabel(['La Plata'])).toBe('La Plata')
  })

  it('separa la clave en tramos', () => {
    expect(zoneSegments('caba/palermo')).toEqual(['caba', 'palermo'])
  })
})

describe('categoría de mercado', () => {
  it.each([
    ['Departamento', MarketCategory.APARTMENT],
    ['Depto 2 ambientes', MarketCategory.APARTMENT],
    ['Monoambiente', MarketCategory.APARTMENT],
    ['Casa', MarketCategory.HOUSE],
    ['Casa quinta', MarketCategory.HOUSE],
    ['PH', MarketCategory.PH],
    ['Local comercial', MarketCategory.COMMERCIAL],
    ['Oficina', MarketCategory.OFFICE],
    ['Cochera', MarketCategory.GARAGE],
    ['Terreno', MarketCategory.LAND],
    ['Lote', MarketCategory.LAND],
  ])('%s es %s', (name, category) => {
    expect(categoryOfPropertyType(name)).toBe(category)
  })

  it('lo que no se reconoce es OTHER', () => {
    expect(categoryOfPropertyType('Castillo')).toBe(MarketCategory.OTHER)
    expect(categoryOfPropertyType('')).toBe(MarketCategory.OTHER)
  })

  it('normaliza las comodidades escritas a mano', () => {
    expect(normalizeAmenity('Balcón')).toBe('balcon')
    expect(normalizeAmenity('  Aire  Acondicionado ')).toBe(
      'aire acondicionado',
    )
  })
})
