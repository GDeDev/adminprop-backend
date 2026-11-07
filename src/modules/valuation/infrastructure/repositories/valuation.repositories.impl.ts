import { Injectable } from '@nestjs/common'
import {
  MarketComparable as ComparableRow,
  ValuationRequest as RequestRow,
  ValuationSourceState as SourceStateRow,
  ValuationZone as ZoneRow,
} from '@prisma/client'

import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  Comparable,
  MarketCategory,
  MarketCurrency,
  MarketOperationRent,
  MarketSource,
  RawComparable,
  RefreshResult,
  ValuationConfidence,
  ValuationEngineKind,
} from '../../domain/market'
import {
  ComparableRepository,
  ComparableSelection,
  NewValuation,
  SourceState,
  SourceStateRepository,
  UpsertResult,
  ValuationRecord,
  ValuationRequestRepository,
  ValuationZoneRepository,
  ZoneRef,
} from '../../domain/valuation.ports'

/** Tope de avisos que entran al cálculo de una zona: más no mejora la mediana. */
const MAX_COMPARABLES_PER_VALUATION = 500

/**
 * Los comparables son del mercado, no de una inmobiliaria: estas tablas no
 * pasan por el filtro de tenant (están declaradas así en `auditable-models`).
 */
@Injectable()
export class ComparableRepositoryImpl extends ComparableRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async upsertMany(
    source: MarketSource,
    zoneKey: string,
    category: MarketCategory,
    items: RawComparable[],
    now: Date,
  ): Promise<UpsertResult> {
    if (items.length === 0) return { created: 0, updated: 0 }
    const existing = await this.prisma.db.marketComparable.findMany({
      where: { source, externalId: { in: items.map((i) => i.externalId) } },
      select: { externalId: true },
    })
    const known = new Set(existing.map((row) => row.externalId))
    let created = 0
    let updated = 0
    for (const item of items) {
      const data = {
        zoneKey,
        category,
        price: item.price,
        currency: item.currency,
        areaM2: item.areaM2,
        bedrooms: item.bedrooms,
        amenities: item.amenities,
        url: item.url.slice(0, 1000),
        publishedAt: item.publishedAt,
        lastSeenAt: now,
        active: true,
      }
      await this.prisma.db.marketComparable.upsert({
        where: {
          source_externalId: { source, externalId: item.externalId },
        },
        create: {
          source,
          externalId: item.externalId,
          firstSeenAt: now,
          ...data,
        },
        update: data,
      })
      if (known.has(item.externalId)) updated += 1
      else created += 1
    }
    return { created, updated }
  }

  async findForValuation(
    selection: ComparableSelection,
  ): Promise<Comparable[]> {
    const rows = await this.prisma.db.marketComparable.findMany({
      where: {
        ...(selection.includeDescendants
          ? {
              OR: [
                { zoneKey: selection.zoneKey },
                { zoneKey: { startsWith: `${selection.zoneKey}/` } },
              ],
            }
          : { zoneKey: selection.zoneKey }),
        category: selection.category,
        currency: selection.currency,
        operation: MarketOperationRent,
        active: true,
        lastSeenAt: { gte: selection.seenSince },
      },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'asc' }],
      take: MAX_COMPARABLES_PER_VALUATION,
    })
    return rows.map(toComparable)
  }

  countActive(
    zoneKey: string,
    includeDescendants: boolean,
    seenSince: Date,
  ): Promise<number> {
    return this.prisma.db.marketComparable.count({
      where: {
        ...(includeDescendants
          ? {
              OR: [{ zoneKey }, { zoneKey: { startsWith: `${zoneKey}/` } }],
            }
          : { zoneKey }),
        active: true,
        lastSeenAt: { gte: seenSince },
      },
    })
  }

  async deactivateUnseenSince(date: Date): Promise<number> {
    const result = await this.prisma.db.marketComparable.updateMany({
      where: { active: true, lastSeenAt: { lt: date } },
      data: { active: false },
    })
    return result.count
  }

  async activeCountsBySource(
    seenSince: Date,
  ): Promise<Map<MarketSource, number>> {
    const groups = await this.prisma.db.marketComparable.groupBy({
      by: ['source'],
      where: { active: true, lastSeenAt: { gte: seenSince } },
      _count: { _all: true },
    })
    return new Map(
      groups.map((g) => [MarketSource[g.source], g._count._all] as const),
    )
  }
}

function toComparable(row: ComparableRow): Comparable {
  return {
    id: row.id,
    source: MarketSource[row.source],
    zoneKey: row.zoneKey,
    price: row.price.toFixed(2),
    currency: row.currency as MarketCurrency,
    areaM2: row.areaM2 ? row.areaM2.toFixed(2) : null,
    bedrooms: row.bedrooms,
    amenities: row.amenities,
    lastSeenAt: row.lastSeenAt,
  }
}

@Injectable()
export class ValuationZoneRepositoryImpl extends ValuationZoneRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async touch(zoneKey: string, category: MarketCategory): Promise<void> {
    await this.prisma.db.valuationZone.upsert({
      where: { zoneKey_category: { zoneKey, category } },
      create: { zoneKey, category, requestedCount: 1 },
      update: { requestedCount: { increment: 1 } },
    })
  }

  async ensure(zoneKey: string, category: MarketCategory): Promise<void> {
    await this.prisma.db.valuationZone.upsert({
      where: { zoneKey_category: { zoneKey, category } },
      create: { zoneKey, category },
      update: {},
    })
  }

  async listDue(limit: number, refreshedBefore: Date): Promise<ZoneRef[]> {
    const rows = await this.prisma.db.valuationZone.findMany({
      where: {
        OR: [
          { lastRefreshedAt: null },
          { lastRefreshedAt: { lt: refreshedBefore } },
        ],
      },
      orderBy: [
        { lastRefreshedAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: limit,
    })
    return rows.map(toZone)
  }

  async listByZoneKey(zoneKey: string): Promise<ZoneRef[]> {
    const rows = await this.prisma.db.valuationZone.findMany({
      where: { zoneKey },
      orderBy: { category: 'asc' },
    })
    return rows.map(toZone)
  }

  async markResult(
    id: string,
    result: RefreshResult,
    now: Date,
  ): Promise<void> {
    const failed =
      result === RefreshResult.BLOCKED || result === RefreshResult.PARSE_ERROR
    await this.prisma.db.valuationZone.update({
      where: { id },
      data: {
        lastRefreshedAt: now,
        lastResult: result,
        consecutiveFailures: failed ? { increment: 1 } : 0,
      },
    })
  }

  async lastRefreshedAt(zoneKey: string): Promise<Date | null> {
    const row = await this.prisma.db.valuationZone.aggregate({
      where: { zoneKey },
      _max: { lastRefreshedAt: true },
    })
    return row._max.lastRefreshedAt
  }
}

function toZone(row: ZoneRow): ZoneRef {
  return {
    id: row.id,
    zoneKey: row.zoneKey,
    category: MarketCategory[row.category],
    lastRefreshedAt: row.lastRefreshedAt,
    lastResult: row.lastResult ? RefreshResult[row.lastResult] : null,
  }
}

@Injectable()
export class SourceStateRepositoryImpl extends SourceStateRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async findAll(): Promise<SourceState[]> {
    const rows = await this.prisma.db.valuationSourceState.findMany()
    return rows.map(toSourceState)
  }

  async save(state: SourceState): Promise<void> {
    const { source, ...data } = state
    await this.prisma.db.valuationSourceState.upsert({
      where: { source },
      create: { source, ...data },
      update: data,
    })
  }
}

function toSourceState(row: SourceStateRow): SourceState {
  return {
    source: MarketSource[row.source],
    lastRunAt: row.lastRunAt,
    lastIngestAt: row.lastIngestAt,
    lastResult: row.lastResult ? RefreshResult[row.lastResult] : null,
    consecutiveFailures: row.consecutiveFailures,
    blockedUntil: row.blockedUntil,
  }
}

/** Las tasaciones son de la inmobiliaria del contexto: `prisma.db` filtra y audita. */
@Injectable()
export class ValuationRequestRepositoryImpl extends ValuationRequestRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewValuation): Promise<ValuationRecord> {
    const row = await this.prisma.db.valuationRequest.create({
      data: {
        propertyId: data.propertyId,
        input: data.input as object,
        inputHash: data.inputHash,
        currency: data.currency,
        minPrice: data.minPrice,
        maxPrice: data.maxPrice,
        suggestedPrice: data.suggestedPrice,
        confidence: data.confidence,
        comparablesUsed: data.comparablesUsed,
        comparablesDiscarded: data.comparablesDiscarded,
        zoneKeyUsed: data.zoneKeyUsed,
        zoneLabel: data.zoneLabel,
        zoneWidened: data.zoneWidened,
        oldestComparableAt: data.oldestComparableAt,
        engine: data.engine,
        justification: data.justification,
        requestedById: data.requestedById,
      } as never,
    })
    return toRecord(row)
  }

  async findRecentByHash(
    propertyId: string,
    inputHash: string,
    since: Date,
  ): Promise<ValuationRecord | null> {
    const row = await this.prisma.db.valuationRequest.findFirst({
      where: { propertyId, inputHash, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    })
    return row ? toRecord(row) : null
  }

  countSince(since: Date): Promise<number> {
    return this.prisma.db.valuationRequest.count({
      where: { createdAt: { gte: since } },
    })
  }

  async listByProperty(
    propertyId: string,
    page: { skip: number; take: number },
  ): Promise<[ValuationRecord[], number]> {
    const where = { propertyId }
    const [rows, total] = await Promise.all([
      this.prisma.db.valuationRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.db.valuationRequest.count({ where }),
    ])
    return [rows.map(toRecord), total]
  }
}

function toRecord(row: RequestRow): ValuationRecord {
  return {
    id: row.id,
    propertyId: row.propertyId,
    currency: row.currency as MarketCurrency,
    minPrice: row.minPrice.toFixed(2),
    maxPrice: row.maxPrice.toFixed(2),
    suggestedPrice: row.suggestedPrice.toFixed(2),
    confidence: ValuationConfidence[row.confidence],
    comparablesUsed: row.comparablesUsed,
    comparablesDiscarded: row.comparablesDiscarded,
    zoneKeyUsed: row.zoneKeyUsed,
    zoneLabel: row.zoneLabel,
    zoneWidened: row.zoneWidened,
    oldestComparableAt: row.oldestComparableAt,
    engine: ValuationEngineKind[row.engine],
    justification: row.justification,
    requestedById: row.requestedById,
    createdAt: row.createdAt,
  }
}
