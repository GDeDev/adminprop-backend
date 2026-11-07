import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MarketCategory, MarketSource } from '../../domain/market'
import {
  SourceBlockedError,
  SourceParseError,
} from '../../domain/valuation.ports'
import { FakeComparableSource } from './fake.source'
import { isPathAllowed, PageFetcher, parseRobots } from './page-fetcher'
import { ArgenpropSource, ZonapropSource } from './portal.sources'

const fixture = (name: string): string =>
  readFileSync(
    join(process.cwd(), 'test', 'fixtures', 'valuation', name),
    'utf8',
  )

function response(status: number, body = ''): Response {
  return new Response(body, { status })
}

/** Un `fetch` que responde según la ruta y registra los pedidos. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = []
  const impl = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const route = routes[new URL(url).pathname]
    return route ? route() : response(404)
  }) as typeof fetch
  return { impl, calls }
}

describe('robots.txt', () => {
  const robots = `
User-agent: *
Disallow: /privado
Allow: /privado/publico
Disallow: /*.pdf$

User-agent: AdminpropBot
Disallow: /solo-para-nosotros
`
  it('usa el grupo que nombra al bot por sobre el de *', () => {
    const rules = parseRobots(robots)
    expect(isPathAllowed(rules, '/solo-para-nosotros/x')).toBe(false)
    expect(isPathAllowed(rules, '/privado')).toBe(true)
  })

  it('con el grupo * gana la regla más larga y se entienden comodines', () => {
    const rules = parseRobots(robots.replace('AdminpropBot', 'otro'))
    expect(isPathAllowed(rules, '/privado/x')).toBe(false)
    expect(isPathAllowed(rules, '/privado/publico/x')).toBe(true)
    expect(isPathAllowed(rules, '/doc/a.pdf')).toBe(false)
    expect(isPathAllowed(rules, '/doc/a.pdf?x=1')).toBe(true)
    expect(isPathAllowed(rules, '/alquiler/palermo')).toBe(true)
  })
})

describe('PageFetcher', () => {
  const newFetcher = (impl: typeof fetch) => {
    const clock = { t: 1_000_000 }
    const sleeps: number[] = []
    const fetcher = new PageFetcher({
      contact: 'contacto@ejemplo.test',
      fetchImpl: impl,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock.t += ms
      },
      now: () => clock.t,
    })
    return { fetcher, sleeps }
  }

  it('se identifica con un User-Agent con contacto', () => {
    const { fetcher } = newFetcher(fakeFetch({}).impl)
    expect(fetcher.userAgent).toBe('AdminpropBot/1.0 (+contacto@ejemplo.test)')
  })

  it('no pide una ruta que robots.txt prohíbe: la fuente queda bloqueada', async () => {
    const { impl, calls } = fakeFetch({
      '/robots.txt': () => response(200, 'User-agent: *\nDisallow: /alquiler'),
    })
    const { fetcher } = newFetcher(impl)

    await expect(
      fetcher.get(
        MarketSource.ZONAPROP,
        'https://portal.test/alquiler/palermo',
      ),
    ).rejects.toBeInstanceOf(SourceBlockedError)
    expect(calls).toEqual(['https://portal.test/robots.txt'])
  })

  it('espera hasta 2,5 s entre requests al mismo dominio', async () => {
    const { impl } = fakeFetch({
      '/robots.txt': () => response(404),
      '/a': () => response(200, '<html>ok</html>'),
      '/b': () => response(200, '<html>ok</html>'),
    })
    const { fetcher, sleeps } = newFetcher(impl)

    await fetcher.get(MarketSource.ZONAPROP, 'https://portal.test/a')
    await fetcher.get(MarketSource.ZONAPROP, 'https://portal.test/b')

    expect(sleeps.length).toBeGreaterThanOrEqual(1)
    expect(Math.max(...sleeps)).toBe(2_500)
  })

  it('ante un 429 espera y reintenta una vez; si sigue, la fuente queda bloqueada', async () => {
    const { impl, calls } = fakeFetch({
      '/robots.txt': () => response(404),
      '/a': () => response(429),
    })
    const { fetcher, sleeps } = newFetcher(impl)

    await expect(
      fetcher.get(MarketSource.ARGENPROP, 'https://portal.test/a'),
    ).rejects.toBeInstanceOf(SourceBlockedError)
    expect(sleeps).toContain(10_000)
    expect(calls.filter((url) => url.endsWith('/a'))).toHaveLength(2)
  })

  it('un captcha corta la fuente sin reintentar', async () => {
    const { impl, calls } = fakeFetch({
      '/robots.txt': () => response(404),
      '/a': () => response(200, fixture('blocked-captcha.html')),
    })
    const { fetcher } = newFetcher(impl)

    await expect(
      fetcher.get(MarketSource.ARGENPROP, 'https://portal.test/a'),
    ).rejects.toThrow(/captcha/)
    expect(calls.filter((url) => url.endsWith('/a'))).toHaveLength(1)
  })

  it('si no puede leer robots.txt no scrapea', async () => {
    const impl = (async () => {
      throw new Error('sin red')
    }) as unknown as typeof fetch
    const { fetcher } = newFetcher(impl)
    await expect(
      fetcher.get(MarketSource.ARGENPROP, 'https://portal.test/a'),
    ).rejects.toBeInstanceOf(SourceBlockedError)
  })
})

describe('fuentes de portales', () => {
  const fetcherFor = (html: string) =>
    new PageFetcher({
      contact: 'x',
      sleep: async () => undefined,
      fetchImpl: fakeFetch({
        '/robots.txt': () => response(404),
        '/departamentos-alquiler-palermo-caba.html': () => response(200, html),
        '/departamento/alquiler/palermo': () => response(200, html),
      }).impl,
    })

  it('Zonaprop arma la URL desde la zona y devuelve los avisos', async () => {
    const source = new ZonapropSource(
      fetcherFor(fixture('zonaprop-results.html')),
    )
    const page = await source.search({
      zoneKey: 'caba/palermo',
      category: MarketCategory.APARTMENT,
      page: 1,
    })
    expect(page.items).toHaveLength(3)
    expect(page.hasMore).toBe(true)
  })

  it('una página rota es PARSE_ERROR, nunca cero comparables', async () => {
    const source = new ArgenpropSource(
      fetcherFor(fixture('argenprop-broken.html')),
    )
    await expect(
      source.search({
        zoneKey: 'caba/palermo',
        category: MarketCategory.APARTMENT,
        page: 1,
      }),
    ).rejects.toBeInstanceOf(SourceParseError)
  })

  it('una categoría que el portal no tiene no hace ningún pedido', async () => {
    const source = new ZonapropSource(fetcherFor('x'))
    await expect(
      source.search({
        zoneKey: 'caba/palermo',
        category: MarketCategory.OTHER,
        page: 1,
      }),
    ).resolves.toEqual({ items: [], hasMore: false })
  })

  it('no pasa de 5 páginas por zona', async () => {
    const source = new ZonapropSource(
      fetcherFor(fixture('zonaprop-results.html')),
    )
    const page = await source.search({
      zoneKey: 'caba/palermo',
      category: MarketCategory.APARTMENT,
      page: 6,
    })
    expect(page).toEqual({ items: [], hasMore: false })
  })
})

describe('FakeComparableSource', () => {
  const query = {
    zoneKey: 'caba/palermo',
    category: MarketCategory.APARTMENT,
    page: 1,
  }

  it('es determinística: la misma zona da los mismos avisos', async () => {
    const a = await new FakeComparableSource().search(query)
    const b = await new FakeComparableSource().search(query)
    expect(a).toEqual(b)
  })

  it('genera avisos en pesos y en dólares, con atípicos, y varía según la zona', async () => {
    const palermo = await new FakeComparableSource().search(query)
    const recoleta = await new FakeComparableSource().search({
      ...query,
      zoneKey: 'caba/recoleta',
    })
    expect(palermo.items.filter((i) => i.currency === 'ARS')).toHaveLength(12)
    expect(palermo.items.filter((i) => i.currency === 'USD')).toHaveLength(8)
    expect(palermo.items[0].price).not.toBe(recoleta.items[0].price)
    expect(new Set(palermo.items.map((i) => i.externalId)).size).toBe(20)
  })

  it('no inventa avisos para OTHER y puede fallar a pedido del test', async () => {
    const source = new FakeComparableSource()
    expect(
      (await source.search({ ...query, category: MarketCategory.OTHER })).items,
    ).toEqual([])
    source.failWith(new SourceBlockedError(MarketSource.FAKE, 'test'))
    await expect(source.search(query)).rejects.toBeInstanceOf(
      SourceBlockedError,
    )
  })
})
