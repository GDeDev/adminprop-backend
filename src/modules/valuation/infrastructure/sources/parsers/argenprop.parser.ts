import { RawComparable } from '../../../domain/market'
import {
  absoluteUrl,
  ParsedPage,
  parseAmenities,
  parseArea,
  parseBedrooms,
  parsePrice,
  splitBlocks,
} from './parse-helpers'

const BASE = 'https://www.argenprop.com'

/**
 * Parser de Argenprop. Todos los selectores viven acá (ver `parseZonaprop`
 * sobre su validez).
 */
export function parseArgenprop(html: string): ParsedPage {
  const cards = splitBlocks(html, /<div[^>]*class="[^"]*listing__item/)
  const items: RawComparable[] = []

  for (const card of cards) {
    const href = card.match(/<a[^>]*href="([^"]+--(\d+))"/)
    const priceText = card.match(
      /class="[^"]*card__price[^"]*"[^>]*>([\s\S]*?)<\/p>/,
    )?.[1]
    const price = priceText ? parsePrice(priceText) : null
    if (!href || !price) continue

    const features =
      card.match(
        /class="[^"]*card__main-features[^"]*"[^>]*>([\s\S]*?)<\/ul>/,
      )?.[1] ?? ''
    items.push({
      externalId: href[2],
      price: price.price,
      currency: price.currency,
      areaM2: parseArea(features),
      bedrooms: parseBedrooms(features),
      amenities: parseAmenities(features),
      url: absoluteUrl(BASE, href[1]),
      publishedAt: null,
    })
  }

  return {
    items,
    totalCards: cards.length,
    explicitlyEmpty: /class="[^"]*listing-empty/.test(html),
    hasMore: /class="[^"]*pagination__page-next/.test(html),
  }
}
