import { MarketCategory, MarketSource } from '../../domain/market'
import {
  ComparableSourcePort,
  SourcePage,
  SourceQuery,
} from '../../domain/valuation.ports'
import { zoneSegments } from '../../domain/zone-key'
import { PageFetcher } from './page-fetcher'
import { parseArgenprop } from './parsers/argenprop.parser'
import { parseMercadoLibre } from './parsers/mercadolibre.parser'
import { assertReadable, ParsedPage } from './parsers/parse-helpers'
import { parseZonaprop } from './parsers/zonaprop.parser'

/** Máximo de páginas por zona y corrida (rediseño 4). */
export const MAX_PAGES_PER_ZONE = 5

/**
 * Una fuente que lee páginas públicas de resultados de alquiler. Sólo cambian
 * la URL y el parser; la cortesía vive en `PageFetcher`.
 */
abstract class PortalSource extends ComparableSourcePort {
  constructor(private readonly fetcher: PageFetcher) {
    super()
  }

  /** null: el portal no tiene esa categoría, no se pide nada. */
  protected abstract urlFor(query: SourceQuery): string | null
  protected abstract parse(html: string): ParsedPage

  async search(query: SourceQuery): Promise<SourcePage> {
    const url = this.urlFor(query)
    if (!url || query.page > MAX_PAGES_PER_ZONE) {
      return { items: [], hasMore: false }
    }
    const page = this.parse(await this.fetcher.get(this.source, url))
    assertReadable(this.source, page)
    return {
      items: page.items,
      hasMore: page.hasMore && query.page < MAX_PAGES_PER_ZONE,
    }
  }
}

/*
 * Las URL siguen el esquema público de cada portal, armado a partir de los
 * últimos tramos de la zona. No se validaron contra los sitios reales (D-181):
 * la primera corrida con COMPARABLES_SOURCES real es supervisada.
 */

const ZONAPROP_CATEGORY: Partial<Record<MarketCategory, string>> = {
  [MarketCategory.APARTMENT]: 'departamentos',
  [MarketCategory.HOUSE]: 'casas',
  [MarketCategory.PH]: 'ph',
  [MarketCategory.OFFICE]: 'oficinas',
  [MarketCategory.COMMERCIAL]: 'locales-comerciales',
  [MarketCategory.GARAGE]: 'cocheras',
  [MarketCategory.LAND]: 'terrenos',
}

export class ZonapropSource extends PortalSource {
  readonly source = MarketSource.ZONAPROP

  protected urlFor({ zoneKey, category, page }: SourceQuery): string | null {
    const kind = ZONAPROP_CATEGORY[category]
    if (!kind) return null
    const place = zoneSegments(zoneKey).slice(-2).reverse().join('-')
    const suffix = page > 1 ? `-pagina-${page}` : ''
    return `https://www.zonaprop.com.ar/${kind}-alquiler-${place}${suffix}.html`
  }

  protected parse(html: string): ParsedPage {
    return parseZonaprop(html)
  }
}

const ARGENPROP_CATEGORY: Partial<Record<MarketCategory, string>> = {
  [MarketCategory.APARTMENT]: 'departamento',
  [MarketCategory.HOUSE]: 'casa',
  [MarketCategory.PH]: 'ph',
  [MarketCategory.OFFICE]: 'oficina',
  [MarketCategory.COMMERCIAL]: 'local',
  [MarketCategory.GARAGE]: 'cochera',
  [MarketCategory.LAND]: 'terreno',
}

export class ArgenpropSource extends PortalSource {
  readonly source = MarketSource.ARGENPROP

  protected urlFor({ zoneKey, category, page }: SourceQuery): string | null {
    const kind = ARGENPROP_CATEGORY[category]
    if (!kind) return null
    const place = zoneSegments(zoneKey).slice(-1)[0]
    const suffix = page > 1 ? `?pagina-${page}` : ''
    return `https://www.argenprop.com/${kind}/alquiler/${place}${suffix}`
  }

  protected parse(html: string): ParsedPage {
    return parseArgenprop(html)
  }
}

const MERCADOLIBRE_CATEGORY: Partial<Record<MarketCategory, string>> = {
  [MarketCategory.APARTMENT]: 'departamentos',
  [MarketCategory.HOUSE]: 'casas',
  [MarketCategory.PH]: 'ph',
  [MarketCategory.OFFICE]: 'oficinas',
  [MarketCategory.COMMERCIAL]: 'locales',
  [MarketCategory.GARAGE]: 'cocheras',
  [MarketCategory.LAND]: 'terrenos',
}

const MERCADOLIBRE_PAGE_SIZE = 48

export class MercadoLibreSource extends PortalSource {
  readonly source = MarketSource.MERCADOLIBRE

  protected urlFor({ zoneKey, category, page }: SourceQuery): string | null {
    const kind = MERCADOLIBRE_CATEGORY[category]
    if (!kind) return null
    const place = zoneSegments(zoneKey).slice(-1)[0]
    const offset =
      page > 1 ? `/_Desde_${(page - 1) * MERCADOLIBRE_PAGE_SIZE + 1}` : ''
    return `https://inmuebles.mercadolibre.com.ar/${kind}/alquiler/${place}${offset}`
  }

  protected parse(html: string): ParsedPage {
    return parseMercadoLibre(html)
  }
}
