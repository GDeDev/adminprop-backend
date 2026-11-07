import { createHash } from 'node:crypto'

import {
  CommandHandler,
  ICommandHandler,
  IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs'

import { AsyncJobsFacade } from '@/modules/jobs/public'
import { MasterDataFacade } from '@/modules/master-data/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { QueuePort } from '@/platform/queue/queue.port'
import { RequestContext } from '@/shared/context/request-context'
import { AppException, ErrorCode } from '@/shared/errors'
import { toDecimal, toMoneyString } from '@/shared/money'
import { PaginatedResult } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import { HttpStatus } from '@nestjs/common'
import {
  MarketCategory,
  MarketCurrency,
  MarketSource,
  RefreshResult,
} from '../domain/market'
import { normalizeAmenity } from '../domain/market-category'
import {
  InsufficientMarketDataException,
  ValuationLocationNotFoundException,
  ValuationNoZoneException,
  ValuationPropertyNotFoundException,
} from '../domain/valuation.exceptions'
import {
  ComparableRepository,
  ComparableSourceRegistry,
  SourceStateRepository,
  ValuationNarratorPort,
  ValuationRequestRepository,
  ValuationZoneRepository,
} from '../domain/valuation.ports'
import { ValuationFacts } from '../domain/valuation-narrative'
import { ValuationPolicy } from '../domain/valuation-policy'
import {
  AppraisePropertyCommand,
  GetMarketCoverageQuery,
  GetMarketStatusQuery,
  ListAppraisalsQuery,
  RefreshZoneCommand,
} from './valuation.commands'
import {
  MarketCoverageView,
  MarketSourceStatus,
  MarketStatusView,
  ValuationView,
  ValuationViews,
} from './valuation.views'
import {
  DAY_MS,
  HOUR_MS,
  REUSE_WINDOW_HOURS,
  ValuationSettings,
  ZoneResolver,
} from './valuation.support'
import { REFRESH_ZONE_JOB_TYPE, REFRESH_ZONE_QUEUE } from './valuation-queues'

function requireUser(): string {
  const userId = RequestContext.userId
  if (!userId)
    throw new Error('Operación de tasación sin usuario en el contexto')
  return userId
}

/** Superficie con 2 decimales, o null si no hay un valor positivo. */
function normalizeArea(area: string | undefined): string | null {
  if (area === undefined) return null
  const value = toDecimal(area)
  return value.gt(0) ? value.toFixed(2) : null
}

/**
 * Pide una tasación (rediseño 5). Síncrono y sin red: sólo lee el caché de
 * comparables. Es una sugerencia: no toca la propiedad (A-46).
 */
@CommandHandler(AppraisePropertyCommand)
export class AppraisePropertyHandler implements ICommandHandler<
  AppraisePropertyCommand,
  ValuationView
> {
  constructor(
    private readonly properties: PropertiesFacade,
    private readonly masterData: MasterDataFacade,
    private readonly resolver: ZoneResolver,
    private readonly comparables: ComparableRepository,
    private readonly zones: ValuationZoneRepository,
    private readonly requests: ValuationRequestRepository,
    private readonly narrator: ValuationNarratorPort,
    private readonly settings: ValuationSettings,
    private readonly views: ValuationViews,
  ) {}

  async execute(command: AppraisePropertyCommand): Promise<ValuationView> {
    const userId = requireUser()
    const property = await this.properties.getForValuation(command.propertyId)
    if (!property)
      throw new ValuationPropertyNotFoundException(command.propertyId)

    const zone = await this.resolver.resolveLocation(property.locationId)
    if (!zone) throw new ValuationNoZoneException(property.id)
    const category =
      (await this.resolver.categoriesOf([property.propertyTypeId])).get(
        property.propertyTypeId,
      ) ?? MarketCategory.OTHER

    const currency: MarketCurrency =
      command.input.currency ?? (property.listingCurrency as MarketCurrency)
    const amenities = await this.amenitiesOf(
      command.input.amenities,
      property.amenityIds,
    )
    const subject = {
      areaM2: normalizeArea(command.input.areaM2),
      bedrooms: command.input.bedrooms ?? null,
      amenities,
    }
    const input = { ...subject, currency, zoneKey: zone.zoneKey, category }
    const inputHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex')

    const now = new Date()
    const reusable = await this.requests.findRecentByHash(
      property.id,
      inputHash,
      new Date(now.getTime() - REUSE_WINDOW_HOURS * HOUR_MS),
    )
    // Una tasación idéntica reciente se devuelve tal cual y no cuenta contra el límite (A-67).
    if (reusable) return this.views.one(reusable, true)

    const dailyLimit = this.settings.values.dailyLimit
    const today = await this.requests.countSince(
      new Date(now.getTime() - DAY_MS),
    )
    if (today >= dailyLimit) {
      throw new AppException(
        ErrorCode.VALUATION_DAILY_LIMIT,
        `Llegaste al límite de ${dailyLimit} tasaciones por día. Probá de nuevo mañana.`,
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    // Se registra la zona aunque falten datos: así el próximo refresco la cubre.
    await this.zones.touch(zone.zoneKey, category)

    const seenSince = this.settings.seenSince(now)
    const minComparables = this.settings.minComparables
    const select = (zoneKey: string, includeDescendants: boolean) =>
      this.comparables.findForValuation({
        zoneKey,
        includeDescendants,
        category,
        currency,
        seenSince,
      })

    let usedZone = { zoneKey: zone.zoneKey, label: zone.label }
    let widened = false
    let found = await select(zone.zoneKey, false)
    let result = ValuationPolicy.compute(subject, found, {
      now,
      minComparables,
    })
    if (!result && zone.parent) {
      found = await select(zone.parent.zoneKey, true)
      result = ValuationPolicy.compute(subject, found, { now, minComparables })
      usedZone = zone.parent
      widened = true
    }
    if (!result) {
      throw new InsufficientMarketDataException(
        usedZone.zoneKey,
        found.length,
        minComparables,
      )
    }

    const confidence = ValuationPolicy.confidenceOf(result.used, widened)
    const facts: ValuationFacts = {
      zoneLabel: usedZone.label,
      zoneWidened: widened,
      currency,
      used: result.used,
      discarded: result.discarded,
      maxAgeDays: this.settings.maxAgeDays,
      min: toMoneyString(result.min),
      max: toMoneyString(result.max),
      suggested: toMoneyString(result.suggested),
      basis: result.basis,
      medianPerM2: result.medianPerM2
        ? toMoneyString(result.medianPerM2)
        : null,
      areaM2: subject.areaM2,
      rangeIsMinMax: result.rangeIsMinMax,
      confidence,
    }
    const narration = await this.narrator.narrate(facts)

    const record = await this.requests.create({
      propertyId: property.id,
      input,
      inputHash,
      currency,
      minPrice: facts.min,
      maxPrice: facts.max,
      suggestedPrice: facts.suggested,
      confidence,
      comparablesUsed: result.used,
      comparablesDiscarded: result.discarded,
      zoneKeyUsed: usedZone.zoneKey,
      zoneLabel: usedZone.label,
      zoneWidened: widened,
      oldestComparableAt: result.oldestSeenAt,
      engine: narration.engine,
      justification: narration.text,
      requestedById: userId,
    })
    return this.views.one(record, false)
  }

  /** Las del pedido, o las de la propiedad; normalizadas y sin repetir. */
  private async amenitiesOf(
    requested: string[] | undefined,
    propertyAmenityIds: string[],
  ): Promise<string[]> {
    const texts =
      requested ??
      [
        ...(
          await this.masterData.describeAmenities(propertyAmenityIds)
        ).values(),
      ].map((amenity) => amenity.name)
    return [...new Set(texts.map(normalizeAmenity).filter(Boolean))].sort()
  }
}

@QueryHandler(ListAppraisalsQuery)
export class ListAppraisalsHandler implements IQueryHandler<
  ListAppraisalsQuery,
  PaginatedResult<ValuationView>
> {
  constructor(
    private readonly properties: PropertiesFacade,
    private readonly requests: ValuationRequestRepository,
    private readonly views: ValuationViews,
  ) {}

  async execute(
    query: ListAppraisalsQuery,
  ): Promise<PaginatedResult<ValuationView>> {
    if (!(await this.properties.getForValuation(query.propertyId))) {
      throw new ValuationPropertyNotFoundException(query.propertyId)
    }
    return paginateWith(query.page, async (args) => {
      const [records, total] = await this.requests.listByProperty(
        query.propertyId,
        args,
      )
      return [await this.views.many(records), total]
    })
  }
}

@QueryHandler(GetMarketStatusQuery)
export class GetMarketStatusHandler implements IQueryHandler<
  GetMarketStatusQuery,
  MarketStatusView
> {
  constructor(
    private readonly registry: ComparableSourceRegistry,
    private readonly states: SourceStateRepository,
    private readonly comparables: ComparableRepository,
    private readonly settings: ValuationSettings,
  ) {}

  async execute(): Promise<MarketStatusView> {
    const now = new Date()
    const enabled = new Set(this.registry.list().map((s) => s.source))
    const states = new Map(
      (await this.states.findAll()).map((s) => [s.source, s]),
    )
    const counts = await this.comparables.activeCountsBySource(
      this.settings.seenSince(now),
    )

    return {
      maxAgeDays: this.settings.maxAgeDays,
      sources: Object.values(MarketSource).map((source) => {
        const state = states.get(source)
        const stale =
          !state?.lastIngestAt ||
          state.lastIngestAt < this.settings.seenSince(now)
        let status: MarketSourceStatus = 'OK'
        if (!enabled.has(source)) status = 'DISABLED'
        else if (state?.blockedUntil && state.blockedUntil > now)
          status = 'BLOCKED'
        else if (state?.lastResult === RefreshResult.PARSE_ERROR)
          status = 'PARSE_ERROR'
        else if (stale) status = 'STALE'
        return {
          source,
          lastIngestAt: state?.lastIngestAt?.toISOString() ?? null,
          status,
          activeComparables: counts.get(source) ?? 0,
        }
      }),
    }
  }
}

@QueryHandler(GetMarketCoverageQuery)
export class GetMarketCoverageHandler implements IQueryHandler<
  GetMarketCoverageQuery,
  MarketCoverageView
> {
  constructor(
    private readonly resolver: ZoneResolver,
    private readonly comparables: ComparableRepository,
    private readonly zones: ValuationZoneRepository,
    private readonly settings: ValuationSettings,
  ) {}

  async execute(query: GetMarketCoverageQuery): Promise<MarketCoverageView> {
    const zone = await this.resolver.resolveLocation(query.locationId)
    if (!zone) throw new ValuationLocationNotFoundException(query.locationId)

    const seenSince = this.settings.seenSince(new Date())
    const min = this.settings.minComparables
    let label = zone.label
    let active = await this.comparables.countActive(
      zone.zoneKey,
      false,
      seenSince,
    )
    // Como la tasación: con pocos avisos en la zona exacta se mira la más amplia.
    if (active < min && zone.parent) {
      const wider = await this.comparables.countActive(
        zone.parent.zoneKey,
        true,
        seenSince,
      )
      if (wider >= min) {
        active = wider
        label = zone.parent.label
      }
    }
    return {
      zoneLabel: label,
      activeComparables: active,
      enoughData: active >= min,
      lastRefreshedAt:
        (await this.zones.lastRefreshedAt(zone.zoneKey))?.toISOString() ?? null,
    }
  }
}

/** Corrida manual de una zona (admin): se encola y responde 202 con el id del AsyncJob. */
@CommandHandler(RefreshZoneCommand)
export class RefreshZoneHandler implements ICommandHandler<
  RefreshZoneCommand,
  { jobId: string }
> {
  constructor(
    private readonly resolver: ZoneResolver,
    private readonly zones: ValuationZoneRepository,
    private readonly jobs: AsyncJobsFacade,
    private readonly queue: QueuePort,
  ) {}

  async execute(command: RefreshZoneCommand): Promise<{ jobId: string }> {
    const zone = await this.resolver.resolveLocation(command.locationId)
    if (!zone) throw new ValuationLocationNotFoundException(command.locationId)
    await this.zones.ensure(zone.zoneKey, MarketCategory.APARTMENT)

    const jobId = await this.jobs.start(REFRESH_ZONE_JOB_TYPE)
    await this.queue.publish(REFRESH_ZONE_QUEUE, {
      jobId,
      zoneKey: zone.zoneKey,
    })
    return { jobId }
  }
}
