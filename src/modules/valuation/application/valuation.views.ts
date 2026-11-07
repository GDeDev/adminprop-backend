import { Injectable } from '@nestjs/common'

import { UsersFacade } from '@/modules/auth/public'
import { ValuationRecord } from '../domain/valuation.ports'
import { ValuationPolicy } from '../domain/valuation-policy'
import { toDecimal, toMoneyString } from '@/shared/money'
import { MarketSource, MarketCurrency } from '../domain/market'

/** `ValuationResult` del contrato (`shared-types/valuation.ts`). */
export interface ValuationView {
  id: string
  propertyId: string
  currency: MarketCurrency
  minPrice: string
  maxPrice: string
  suggestedPrice: string
  suggestedPriceRounded: string
  confidence: string
  comparablesUsed: number
  comparablesDiscarded: number
  zoneLabel: string
  zoneWidened: boolean
  oldestComparableAt: string | null
  justification: string
  engine: string
  requestedBy: { id: string; fullName: string }
  createdAt: string
  reused: boolean
}

export type MarketSourceStatus =
  'OK' | 'STALE' | 'BLOCKED' | 'PARSE_ERROR' | 'DISABLED'

export interface MarketStatusView {
  sources: {
    source: MarketSource
    lastIngestAt: string | null
    status: MarketSourceStatus
    activeComparables: number
  }[]
  maxAgeDays: number
}

export interface MarketCoverageView {
  zoneLabel: string
  activeComparables: number
  enoughData: boolean
  lastRefreshedAt: string | null
}

@Injectable()
export class ValuationViews {
  constructor(private readonly users: UsersFacade) {}

  async many(
    records: ValuationRecord[],
    reusedIds: Set<string> = new Set(),
  ): Promise<ValuationView[]> {
    const people = await this.users.describe(
      records.map((r) => r.requestedById),
    )
    return records.map((record) => ({
      id: record.id,
      propertyId: record.propertyId,
      currency: record.currency,
      minPrice: record.minPrice,
      maxPrice: record.maxPrice,
      suggestedPrice: record.suggestedPrice,
      suggestedPriceRounded: toMoneyString(
        ValuationPolicy.roundForDisplay(
          toDecimal(record.suggestedPrice),
          record.currency,
        ),
      ),
      confidence: record.confidence,
      comparablesUsed: record.comparablesUsed,
      comparablesDiscarded: record.comparablesDiscarded,
      zoneLabel: record.zoneLabel,
      zoneWidened: record.zoneWidened,
      oldestComparableAt: record.oldestComparableAt?.toISOString() ?? null,
      justification: record.justification,
      engine: record.engine,
      requestedBy: people.get(record.requestedById) ?? {
        id: record.requestedById,
        fullName: 'Usuario eliminado',
      },
      createdAt: record.createdAt.toISOString(),
      reused: reusedIds.has(record.id),
    }))
  }

  async one(record: ValuationRecord, reused: boolean): Promise<ValuationView> {
    const [view] = await this.many(
      [record],
      reused ? new Set([record.id]) : new Set(),
    )
    return view
  }
}
