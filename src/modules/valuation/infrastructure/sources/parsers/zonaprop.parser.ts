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

const BASE = 'https://www.zonaprop.com.ar'

/**
 * Parser de Zonaprop. Todos los selectores viven acá: si el portal cambia su
 * HTML, se arregla en este archivo y su fixture. No se probó contra el sitio
 * real (D-181): la primera corrida real es supervisada.
 */
export function parseZonaprop(html: string): ParsedPage {
  const cards = splitBlocks(html, /<div[^>]*data-posting-type=/)
  const items: RawComparable[] = []

  for (const card of cards) {
    const id = card.match(/data-id="([^"]+)"/)?.[1]
    const href = card.match(/data-to-posting="([^"]+)"/)?.[1]
    const priceText = card.match(
      /data-qa="POSTING_CARD_PRICE"[^>]*>([\s\S]*?)<\/div>/,
    )?.[1]
    const price = priceText ? parsePrice(priceText) : null
    if (!id || !price) continue

    const features =
      card.match(
        /data-qa="POSTING_CARD_FEATURES"[^>]*>([\s\S]*?)<\/(?:div|ul)>/,
      )?.[1] ?? ''
    items.push({
      externalId: id,
      price: price.price,
      currency: price.currency,
      areaM2: parseArea(features),
      bedrooms: parseBedrooms(features),
      amenities: parseAmenities(features),
      url: href ? absoluteUrl(BASE, href) : BASE,
      publishedAt: null,
    })
  }

  return {
    items,
    totalCards: cards.length,
    explicitlyEmpty: /data-qa="NO_RESULTS"/.test(html),
    hasMore: /data-qa="PAGING_NEXT"/.test(html),
  }
}
