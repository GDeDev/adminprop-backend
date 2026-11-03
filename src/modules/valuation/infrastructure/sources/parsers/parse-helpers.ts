import {
  MarketCurrency,
  MarketSource,
  RawComparable,
} from '../../../domain/market'
import { SourceParseError } from '../../../domain/valuation.ports'
import { normalizeAmenity } from '../../../domain/market-category'

/** Lo que un parser extrae de una página de resultados. */
export interface ParsedPage {
  items: RawComparable[]
  /** Tarjetas de aviso encontradas, hayan servido o no (detecta cambios de estructura). */
  totalCards: number
  /** La página dice, con sus palabras, que no hay resultados. */
  explicitlyEmpty: boolean
  hasMore: boolean
}

/** Más de esta proporción de tarjetas ilegibles es un cambio de estructura, no un aviso raro. */
export const MAX_UNREADABLE_RATIO = 0.5

/**
 * "Cero ítems" nunca se confunde con "se rompió el parser" (rediseño 4): una
 * página sin tarjetas que no dice que está vacía, o con más de la mitad de las
 * tarjetas sin precio o id, es `PARSE_ERROR`.
 */
export function assertReadable(source: MarketSource, page: ParsedPage): void {
  if (page.totalCards === 0) {
    if (page.explicitlyEmpty) return
    throw new SourceParseError(
      source,
      'la página no tiene avisos ni dice que no hay resultados',
    )
  }
  const unreadable = page.totalCards - page.items.length
  if (unreadable / page.totalCards > MAX_UNREADABLE_RATIO) {
    throw new SourceParseError(
      source,
      `${unreadable} de ${page.totalCards} avisos sin precio o identificador`,
    )
  }
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&sup2;/g, '²')
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
}

/** "$ 450.000", "USD 1.200", "U$S 800" → `{ price: "450000.00", currency }`. */
export function parsePrice(
  text: string,
): { price: string; currency: MarketCurrency } | null {
  const clean = stripTags(text)
  const currency: MarketCurrency = /usd|u\$s|us\$|dólar|dolar/i.test(clean)
    ? 'USD'
    : 'ARS'
  const match = clean.match(/\d[\d.,]*/)
  if (!match) return null
  const digits = match[0]
  // Formato argentino: el punto separa miles y la coma, decimales.
  const normalized = digits.replace(/\./g, '').replace(',', '.')
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) return null
  return { price: value.toFixed(2), currency }
}

/** "45 m²", "45,5 m2 tot." → "45.50". */
export function parseArea(text: string): string | null {
  const match = stripTags(text).match(/(\d[\d.,]*)\s*m(?:²|2)/i)
  if (!match) return null
  const value = Number(match[1].replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value.toFixed(2) : null
}

/** "2 amb.", "1 dorm." → ambientes/dormitorios. Un monoambiente es 1. */
export function parseBedrooms(text: string): number | null {
  const clean = stripTags(text)
  if (/monoambiente/i.test(clean)) return 1
  const match = clean.match(/(\d{1,2})\s*(?:amb|dorm|hab)/i)
  return match ? Number(match[1]) : null
}

const KNOWN_AMENITIES = ['balcon', 'cochera', 'terraza', 'pileta', 'parrilla']

/** Las comodidades que el texto de la tarjeta nombra, normalizadas. */
export function parseAmenities(text: string): string[] {
  const normalized = normalizeAmenity(stripTags(text))
  return KNOWN_AMENITIES.filter((amenity) => normalized.includes(amenity))
}

/** Parte el HTML en bloques que empiezan en cada coincidencia de `start`. */
export function splitBlocks(html: string, start: RegExp): string[] {
  const flags = start.flags.includes('g') ? start.flags : `${start.flags}g`
  const regex = new RegExp(start.source, flags)
  const positions: number[] = []
  for (const match of html.matchAll(regex)) positions.push(match.index)
  return positions.map((from, i) => html.slice(from, positions[i + 1]))
}

export function absoluteUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}
