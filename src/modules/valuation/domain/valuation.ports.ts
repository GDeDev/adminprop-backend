import {
  Comparable,
  MarketCategory,
  MarketCurrency,
  MarketSource,
  RawComparable,
  RefreshResult,
  ValuationConfidence,
  ValuationEngineKind,
} from './market'
import { ValuationFacts } from './valuation-narrative'

// ------------------------------------------------------------------ Fuentes

export interface SourceQuery {
  zoneKey: string
  category: MarketCategory
  /** Desde 1. */
  page: number
}

export interface SourcePage {
  items: RawComparable[]
  hasMore: boolean
}

/** La fuente cortó el paso: robots.txt, 403/429 sostenido o captcha. */
export class SourceBlockedError extends Error {
  constructor(
    readonly source: MarketSource,
    reason: string,
  ) {
    super(`${source} bloqueada: ${reason}`)
    this.name = 'SourceBlockedError'
  }
}

/** La página llegó pero no se pudo leer: cambió la estructura (nunca es "cero avisos"). */
export class SourceParseError extends Error {
  constructor(
    readonly source: MarketSource,
    reason: string,
  ) {
    super(`${source} no se pudo leer: ${reason}`)
    this.name = 'SourceParseError'
  }
}

/**
 * Una fuente de avisos de alquiler (rediseño 4). El dominio no sabe si lee un
 * portal por HTTP o inventa los datos de prueba.
 */
export abstract class ComparableSourcePort {
  abstract readonly source: MarketSource
  abstract search(query: SourceQuery): Promise<SourcePage>
}

/** Las fuentes activas según `COMPARABLES_SOURCES`. */
export abstract class ComparableSourceRegistry {
  abstract list(): ComparableSourcePort[]
}

// ------------------------------------------------------------------ Redacción

export interface Narration {
  text: string
  engine: ValuationEngineKind
}

/** Redacta la justificación a partir de números ya calculados (A-60). */
export abstract class ValuationNarratorPort {
  abstract narrate(facts: ValuationFacts): Promise<Narration>
}

// ------------------------------------------------------------------ Repositorios

export interface UpsertResult {
  created: number
  updated: number
}

export interface ComparableSelection {
  /** Exacta, o todas las que cuelgan de esta (`prefix/…`). */
  zoneKey: string
  includeDescendants: boolean
  category: MarketCategory
  currency: MarketCurrency
  seenSince: Date
}

/** Los comparables son globales: ningún método recibe tenant. */
export abstract class ComparableRepository {
  /** Por `(source, externalId)`: re-ver un aviso actualiza precio y fecha, no duplica. */
  abstract upsertMany(
    source: MarketSource,
    zoneKey: string,
    category: MarketCategory,
    items: RawComparable[],
    now: Date,
  ): Promise<UpsertResult>
  abstract findForValuation(
    selection: ComparableSelection,
  ): Promise<Comparable[]>
  /** Vigentes de la zona, sin distinguir categoría ni moneda (cobertura). */
  abstract countActive(
    zoneKey: string,
    includeDescendants: boolean,
    seenSince: Date,
  ): Promise<number>
  /** Marca como inactivo lo que no se ve desde `date`. */
  abstract deactivateUnseenSince(date: Date): Promise<number>
  abstract activeCountsBySource(
    seenSince: Date,
  ): Promise<Map<MarketSource, number>>
}

export interface ZoneRef {
  id: string
  zoneKey: string
  category: MarketCategory
  lastRefreshedAt: Date | null
  lastResult: RefreshResult | null
}

export abstract class ValuationZoneRepository {
  /** Alguien pidió esta zona: la registra y cuenta el pedido. */
  abstract touch(zoneKey: string, category: MarketCategory): Promise<void>
  /** La zona tiene propiedades disponibles: la registra sin contar un pedido. */
  abstract ensure(zoneKey: string, category: MarketCategory): Promise<void>
  /** Las más atrasadas primero (las nunca refrescadas, antes), hasta `limit`. */
  abstract listDue(limit: number, refreshedBefore: Date): Promise<ZoneRef[]>
  abstract listByZoneKey(zoneKey: string): Promise<ZoneRef[]>
  abstract markResult(
    id: string,
    result: RefreshResult,
    now: Date,
  ): Promise<void>
  abstract lastRefreshedAt(zoneKey: string): Promise<Date | null>
}

export interface SourceState {
  source: MarketSource
  lastRunAt: Date | null
  lastIngestAt: Date | null
  lastResult: RefreshResult | null
  consecutiveFailures: number
  blockedUntil: Date | null
}

export abstract class SourceStateRepository {
  abstract findAll(): Promise<SourceState[]>
  abstract save(state: SourceState): Promise<void>
}

export interface ValuationRecord {
  id: string
  propertyId: string
  currency: MarketCurrency
  minPrice: string
  maxPrice: string
  suggestedPrice: string
  confidence: ValuationConfidence
  comparablesUsed: number
  comparablesDiscarded: number
  zoneKeyUsed: string
  zoneLabel: string
  zoneWidened: boolean
  oldestComparableAt: Date | null
  engine: ValuationEngineKind
  justification: string
  requestedById: string
  createdAt: Date
}

export interface NewValuation extends Omit<
  ValuationRecord,
  'id' | 'createdAt'
> {
  input: Record<string, unknown>
  inputHash: string
}

/** Las tasaciones son de la inmobiliaria del contexto. */
export abstract class ValuationRequestRepository {
  abstract create(data: NewValuation): Promise<ValuationRecord>
  abstract findRecentByHash(
    propertyId: string,
    inputHash: string,
    since: Date,
  ): Promise<ValuationRecord | null>
  /** Cuántas hizo esta inmobiliaria desde esa fecha (límite diario y aviso de fuente rota). */
  abstract countSince(since: Date): Promise<number>
  abstract listByProperty(
    propertyId: string,
    page: { skip: number; take: number },
  ): Promise<[ValuationRecord[], number]>
}
