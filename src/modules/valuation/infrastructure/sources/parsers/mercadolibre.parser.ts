import { RawComparable } from '../../../domain/market'
import { ParsedPage, parsePrice } from './parse-helpers'

interface JsonLdProduct {
  '@type'?: string
  url?: string
  sku?: string
  offers?: { price?: string | number; priceCurrency?: string }
  floorSize?: { value?: string | number }
  numberOfRooms?: string | number
}

/**
 * Parser de Mercado Libre: lee el JSON-LD de la página (`Product` con
 * `offers`), que es más estable que las clases CSS. La superficie y los
 * ambientes sólo salen si el JSON-LD los trae. Ver `parseZonaprop` sobre su
 * validez.
 */
export function parseMercadoLibre(html: string): ParsedPage {
  const products: JsonLdProduct[] = []
  for (const match of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      collectProducts(JSON.parse(match[1]), products)
    } catch {
      // Un bloque que no es JSON no es un aviso: se cuenta la página sin él.
    }
  }

  const items: RawComparable[] = []
  for (const product of products) {
    const idFromUrl = product.url?.match(/MLA-?(\d+)/i)?.[1]
    const id = product.sku ?? idFromUrl
    const price =
      product.offers?.price !== undefined
        ? parsePrice(
            `${product.offers.priceCurrency === 'USD' ? 'USD ' : '$ '}${String(product.offers.price).replace('.', ',')}`,
          )
        : null
    if (!id || !price || !product.url) continue

    const area = Number(product.floorSize?.value)
    const rooms = Number(product.numberOfRooms)
    items.push({
      externalId: String(id),
      price: price.price,
      currency: price.currency,
      areaM2: Number.isFinite(area) && area > 0 ? area.toFixed(2) : null,
      bedrooms: Number.isFinite(rooms) && rooms > 0 ? rooms : null,
      amenities: [],
      url: product.url,
      publishedAt: null,
    })
  }

  return {
    items,
    totalCards: products.length,
    explicitlyEmpty: /ui-search-rescue/.test(html),
    hasMore: /title="Siguiente"/.test(html),
  }
}

function collectProducts(node: unknown, out: JsonLdProduct[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectProducts(child, out)
    return
  }
  if (node && typeof node === 'object') {
    const object = node as Record<string, unknown>
    if (object['@type'] === 'Product') out.push(object as JsonLdProduct)
    for (const value of Object.values(object)) {
      if (value && typeof value === 'object') collectProducts(value, out)
    }
  }
}
