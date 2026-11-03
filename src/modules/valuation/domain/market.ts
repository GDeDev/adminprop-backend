/** Coinciden con los enums de Prisma. */
export enum MarketSource {
  ZONAPROP = 'ZONAPROP',
  ARGENPROP = 'ARGENPROP',
  MERCADOLIBRE = 'MERCADOLIBRE',
  FAKE = 'FAKE',
}

export enum MarketCategory {
  APARTMENT = 'APARTMENT',
  HOUSE = 'HOUSE',
  PH = 'PH',
  COMMERCIAL = 'COMMERCIAL',
  LAND = 'LAND',
  GARAGE = 'GARAGE',
  OFFICE = 'OFFICE',
  OTHER = 'OTHER',
}

export enum ValuationConfidence {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum ValuationEngineKind {
  STATISTICAL = 'STATISTICAL',
  STATISTICAL_LLM = 'STATISTICAL_LLM',
}

/** Cómo terminó un refresco de zona o de fuente. */
export enum RefreshResult {
  OK = 'OK',
  EMPTY = 'EMPTY',
  BLOCKED = 'BLOCKED',
  PARSE_ERROR = 'PARSE_ERROR',
}

export type MarketCurrency = 'ARS' | 'USD'

/** Un aviso tal como lo devuelve una fuente, antes de guardarlo. */
export interface RawComparable {
  /** Id del aviso en la fuente. */
  externalId: string
  /** Decimal como string ("450000.00"). */
  price: string
  currency: MarketCurrency
  areaM2: string | null
  bedrooms: number | null
  /** Texto normalizado: `balcon`, `cochera`... */
  amenities: string[]
  url: string
  publishedAt: Date | null
}

/** Un aviso guardado, lo que usa el cálculo. */
export interface Comparable {
  id: string
  source: MarketSource
  zoneKey: string
  price: string
  currency: MarketCurrency
  areaM2: string | null
  bedrooms: number | null
  amenities: string[]
  lastSeenAt: Date
}
