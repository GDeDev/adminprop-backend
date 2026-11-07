import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MarketSource } from '../../../domain/market'
import { SourceParseError } from '../../../domain/valuation.ports'
import { parseArgenprop } from './argenprop.parser'
import { parseMercadoLibre } from './mercadolibre.parser'
import {
  assertReadable,
  parseAmenities,
  parseArea,
  parseBedrooms,
  parsePrice,
} from './parse-helpers'
import { parseZonaprop } from './zonaprop.parser'

const fixture = (name: string): string =>
  readFileSync(
    join(process.cwd(), 'test', 'fixtures', 'valuation', name),
    'utf8',
  )

describe('helpers de parseo', () => {
  it('lee precios con formato argentino y la moneda', () => {
    expect(parsePrice('$ 450.000')).toEqual({
      price: '450000.00',
      currency: 'ARS',
    })
    expect(parsePrice('USD 1.200')).toEqual({
      price: '1200.00',
      currency: 'USD',
    })
    expect(parsePrice('U$S 800,50')).toEqual({
      price: '800.50',
      currency: 'USD',
    })
    expect(parsePrice('Consultar')).toBeNull()
    expect(parsePrice('$ 0')).toBeNull()
  })

  it('lee superficie, ambientes y comodidades', () => {
    expect(parseArea('<span>45,5 m² tot.</span>')).toBe('45.50')
    expect(parseArea('sin dato')).toBeNull()
    expect(parseBedrooms('2 amb.')).toBe(2)
    expect(parseBedrooms('Monoambiente')).toBe(1)
    expect(parseAmenities('Balcón y cochera')).toEqual(['balcon', 'cochera'])
  })
})

describe('parser de Zonaprop', () => {
  it('lee los avisos del fixture', () => {
    const page = parseZonaprop(fixture('zonaprop-results.html'))

    expect(page.totalCards).toBe(3)
    expect(page.hasMore).toBe(true)
    expect(page.items).toHaveLength(3)
    expect(page.items[0]).toMatchObject({
      externalId: '1001',
      price: '450000.00',
      currency: 'ARS',
      areaM2: '45.00',
      bedrooms: 2,
      amenities: ['balcon'],
      url: 'https://www.zonaprop.com.ar/propiedades/depto-palermo-1001.html',
    })
    expect(page.items[1]).toMatchObject({ currency: 'USD', price: '800.00' })
    expect(page.items[2].bedrooms).toBe(1)
    expect(() => assertReadable(MarketSource.ZONAPROP, page)).not.toThrow()
  })

  it('una página que dice que no hay resultados es vacía, no un error', () => {
    const page = parseZonaprop(fixture('zonaprop-empty.html'))
    expect(page.items).toEqual([])
    expect(() => assertReadable(MarketSource.ZONAPROP, page)).not.toThrow()
  })

  it('si cambió la estructura (sin avisos y sin aviso de vacío) es PARSE_ERROR', () => {
    const page = parseZonaprop(fixture('zonaprop-redesign.html'))
    expect(() => assertReadable(MarketSource.ZONAPROP, page)).toThrow(
      SourceParseError,
    )
  })

  it('si más de la mitad de las tarjetas no se leen es PARSE_ERROR', () => {
    const page = parseZonaprop(fixture('zonaprop-broken.html'))
    expect(page.totalCards).toBe(3)
    expect(page.items).toHaveLength(1)
    expect(() => assertReadable(MarketSource.ZONAPROP, page)).toThrow(
      /sin precio o identificador/,
    )
  })
})

describe('parser de Argenprop', () => {
  it('lee los avisos del fixture', () => {
    const page = parseArgenprop(fixture('argenprop-results.html'))

    expect(page.totalCards).toBe(2)
    expect(page.hasMore).toBe(true)
    expect(page.items[0]).toMatchObject({
      externalId: '5550001',
      price: '380000.00',
      currency: 'ARS',
      areaM2: '40.00',
      bedrooms: 1,
      amenities: ['cochera'],
    })
    expect(page.items[1]).toMatchObject({
      externalId: '5550002',
      price: '650.00',
      currency: 'USD',
      areaM2: '55.50',
    })
  })

  it('distingue vacío de roto', () => {
    expect(() =>
      assertReadable(
        MarketSource.ARGENPROP,
        parseArgenprop(fixture('argenprop-empty.html')),
      ),
    ).not.toThrow()
    expect(() =>
      assertReadable(
        MarketSource.ARGENPROP,
        parseArgenprop(fixture('argenprop-broken.html')),
      ),
    ).toThrow(SourceParseError)
  })
})

describe('parser de Mercado Libre', () => {
  it('lee el JSON-LD y descarta el aviso sin precio', () => {
    const page = parseMercadoLibre(fixture('mercadolibre-results.html'))

    expect(page.totalCards).toBe(3)
    expect(page.items).toHaveLength(2)
    expect(page.items[0]).toMatchObject({
      externalId: '1111111',
      price: '420000.00',
      areaM2: '48.00',
      bedrooms: 2,
    })
    expect(page.items[1]).toMatchObject({ currency: 'USD', price: '700.50' })
    expect(page.hasMore).toBe(true)
    expect(() => assertReadable(MarketSource.MERCADOLIBRE, page)).not.toThrow()
  })

  it('un JSON-LD sin ofertas es PARSE_ERROR', () => {
    const page = parseMercadoLibre(fixture('mercadolibre-broken.html'))
    expect(() => assertReadable(MarketSource.MERCADOLIBRE, page)).toThrow(
      SourceParseError,
    )
  })
})
