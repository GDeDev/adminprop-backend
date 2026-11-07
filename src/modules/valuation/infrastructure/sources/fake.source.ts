import { createHash } from 'node:crypto'

import {
  MarketCategory,
  MarketCurrency,
  MarketSource,
  RawComparable,
} from '../../domain/market'
import {
  ComparableSourcePort,
  SourcePage,
  SourceQuery,
} from '../../domain/valuation.ports'

/** Cuántos avisos genera por moneda y zona, de los cuales los últimos son atípicos. */
const ARS_COUNT = 12
const USD_COUNT = 8
const OUTLIERS = 2

/** Precio base por m² (en la moneda) según la categoría, para que el dato se vea creíble. */
const BASE_PER_M2: Record<MarketCurrency, number> = { ARS: 9_000, USD: 14 }

/** Generador determinístico a partir de un texto: mismo input, mismos avisos. */
function seeded(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0)
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

/**
 * La fuente de desarrollo y de CI (rediseño 4): inventa avisos
 * determinísticos por zona, con dispersión controlada y un par de atípicos.
 * Es la única activa con `COMPARABLES_SOURCES=fake`. Los tests pueden darle
 * avisos propios (`use`) o hacerla fallar (`failWith`).
 */
export class FakeComparableSource extends ComparableSourcePort {
  readonly source = MarketSource.FAKE
  private readonly scripted = new Map<string, RawComparable[]>()
  private failure: Error | null = null

  /** Para tests: esa zona devuelve exactamente estos avisos. */
  use(zoneKey: string, items: RawComparable[]): void {
    this.scripted.set(zoneKey, items)
  }

  /** Para tests: toda búsqueda tira este error. */
  failWith(error: Error | null): void {
    this.failure = error
  }

  reset(): void {
    this.scripted.clear()
    this.failure = null
  }

  async search(query: SourceQuery): Promise<SourcePage> {
    if (this.failure) throw this.failure
    if (query.page > 1) return { items: [], hasMore: false }
    const scripted = this.scripted.get(query.zoneKey)
    if (scripted) return { items: scripted, hasMore: false }
    // Sólo se inventan categorías que se alquilan por tamaño.
    if (query.category === MarketCategory.OTHER) {
      return { items: [], hasMore: false }
    }
    return {
      items: [
        ...this.generate(query, 'ARS', ARS_COUNT),
        ...this.generate(query, 'USD', USD_COUNT),
      ],
      hasMore: false,
    }
  }

  private generate(
    { zoneKey, category }: SourceQuery,
    currency: MarketCurrency,
    count: number,
  ): RawComparable[] {
    const random = seeded(`${zoneKey}|${category}|${currency}`)
    // La zona fija el nivel de precios (±40 %) para que no todas den lo mismo.
    const level = 0.8 + random() * 0.8
    const perM2 = BASE_PER_M2[currency] * level
    return Array.from({ length: count }, (_, index) => {
      const area = 28 + Math.round(random() * 60)
      const bedrooms = Math.max(1, Math.round(area / 25))
      const spread = 0.88 + random() * 0.24
      const outlier = index >= count - OUTLIERS
      const factor = outlier ? (index % 2 === 0 ? 4.5 : 0.12) : spread
      const price = (perM2 * area * factor).toFixed(2)
      return {
        externalId: `fake-${zoneKey}-${category}-${currency}-${index}`,
        price,
        currency,
        areaM2: area.toFixed(2),
        bedrooms,
        amenities: random() > 0.5 ? ['balcon'] : [],
        url: `https://fake.invalid/${zoneKey}/${index}`,
        publishedAt: null,
      }
    })
  }
}
