import { Injectable } from '@nestjs/common'

import { PropertiesFacade } from '@/modules/properties/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { RequestContext } from '@/shared/context/request-context'
import { errorMessage } from '@/shared/core/error-message'
import { toIsoDate } from '@/shared/dates/calendar-date'
import { createLogger } from '@/shared/logging/root-logger'
import { MarketCategory, MarketSource, RefreshResult } from '../domain/market'
import {
  ComparableRepository,
  ComparableSourcePort,
  ComparableSourceRegistry,
  SourceBlockedError,
  SourceParseError,
  SourceState,
  SourceStateRepository,
  ValuationRequestRepository,
  ValuationZoneRepository,
  ZoneRef,
} from '../domain/valuation.ports'
import {
  ACTIVE_APPRAISER_DAYS,
  DAY_MS,
  HOUR_MS,
  INACTIVE_AFTER_DAYS,
  SOURCE_BLOCK_HOURS,
  STALE_AFTER_FAILURES,
  ZONE_REFRESH_INTERVAL_HOURS,
  ZoneResolver,
} from './valuation.support'

/** Páginas por zona y corrida (rediseño 4). */
const MAX_PAGES = 5

export interface SourceRunSummary {
  source: MarketSource
  result: RefreshResult | 'SKIPPED'
  created: number
  updated: number
  detail: string | null
}

export interface RefreshSummary {
  zones: number
  created: number
  updated: number
  deactivated: number
  sources: SourceRunSummary[]
  /** Fuentes con 3 corridas seguidas sin datos. */
  staleSources: MarketSource[]
}

/**
 * Trae avisos nuevos de las fuentes activas para las zonas que lo necesitan
 * (rediseño 4.1). Corre en el job global y en la corrida manual de una zona;
 * nunca dentro del request de una tasación.
 */
@Injectable()
export class ComparablesRefreshService {
  private readonly logger = createLogger('ComparablesRefresh')

  constructor(
    private readonly registry: ComparableSourceRegistry,
    private readonly comparables: ComparableRepository,
    private readonly zones: ValuationZoneRepository,
    private readonly states: SourceStateRepository,
    private readonly requests: ValuationRequestRepository,
    private readonly resolver: ZoneResolver,
    private readonly properties: PropertiesFacade,
    private readonly tenants: TenantsFacade,
    private readonly notifications: NotificationsService,
  ) {}

  /** El job diario: descubre zonas con propiedades, refresca las más atrasadas. */
  async runScheduled(now: Date, limit: number): Promise<RefreshSummary> {
    await this.discoverZones()
    const due = await this.zones.listDue(limit, this.refreshBefore(now))
    const summary = await this.refresh(due, now)
    await this.notifyStale(summary.staleSources, now)
    return summary
  }

  /** La corrida manual de una zona (todas sus categorías registradas, o las comunes). */
  async runZone(zoneKey: string, now: Date): Promise<RefreshSummary> {
    for (const category of [
      MarketCategory.APARTMENT,
      MarketCategory.HOUSE,
      MarketCategory.PH,
    ]) {
      await this.zones.ensure(zoneKey, category)
    }
    const all = await this.zones.listByZoneKey(zoneKey)
    const due = all.filter(
      (zone) =>
        !zone.lastRefreshedAt || zone.lastRefreshedAt < this.refreshBefore(now),
    )
    return this.refresh(due, now)
  }

  private refreshBefore(now: Date): Date {
    return new Date(now.getTime() - ZONE_REFRESH_INTERVAL_HOURS * HOUR_MS)
  }

  /**
   * Las zonas donde alguna inmobiliaria tiene propiedades disponibles se
   * refrescan aunque nadie haya tasado (A-63).
   */
  private async discoverZones(): Promise<void> {
    for (const tenant of await this.tenants.listActive()) {
      await RequestContext.runInTenant(tenant.id, async () => {
        const available = await this.properties.listAvailableForValuation()
        const categories = await this.resolver.categoriesOf([
          ...new Set(available.map((p) => p.propertyTypeId)),
        ])
        const seen = new Set<string>()
        for (const property of available) {
          const zone = await this.resolver.resolveLocation(property.locationId)
          const category = categories.get(property.propertyTypeId)
          if (!zone || !category || category === MarketCategory.OTHER) continue
          const key = `${zone.zoneKey}|${category}`
          if (seen.has(key)) continue
          seen.add(key)
          await this.zones.ensure(zone.zoneKey, category)
        }
      })
    }
  }

  async refresh(zones: ZoneRef[], now: Date): Promise<RefreshSummary> {
    const deactivated = await this.comparables.deactivateUnseenSince(
      new Date(now.getTime() - INACTIVE_AFTER_DAYS * DAY_MS),
    )
    const states = new Map(
      (await this.states.findAll()).map((s) => [s.source, s]),
    )
    const zoneResults = new Map<string, RefreshResult[]>()
    const summaries: SourceRunSummary[] = []

    for (const source of this.registry.list()) {
      const previous = states.get(source.source) ?? emptyState(source.source)
      if (previous.blockedUntil && previous.blockedUntil > now) {
        summaries.push({
          source: source.source,
          result: 'SKIPPED',
          created: 0,
          updated: 0,
          detail: 'Fuente cortada por bloqueo',
        })
        continue
      }
      const summary = await this.runSource(source, zones, now, zoneResults)
      summaries.push(summary)
      await this.states.save(nextState(previous, summary, now))
    }

    for (const zone of zones) {
      const results = zoneResults.get(zone.id)
      if (results?.length) {
        await this.zones.markResult(zone.id, zoneResultOf(results), now)
      }
    }

    const enabled = new Set(this.registry.list().map((s) => s.source))
    const staleSources = (await this.states.findAll())
      .filter(
        (s) =>
          enabled.has(s.source) &&
          s.consecutiveFailures >= STALE_AFTER_FAILURES,
      )
      .map((s) => s.source)

    return {
      zones: zones.length,
      created: summaries.reduce((sum, s) => sum + s.created, 0),
      updated: summaries.reduce((sum, s) => sum + s.updated, 0),
      deactivated,
      sources: summaries,
      staleSources,
    }
  }

  /** Recorre las zonas con una fuente; ante bloqueo o rotura corta esa fuente, no las demás. */
  private async runSource(
    source: ComparableSourcePort,
    zones: ZoneRef[],
    now: Date,
    zoneResults: Map<string, RefreshResult[]>,
  ): Promise<SourceRunSummary> {
    let created = 0
    let updated = 0
    let failure: { result: RefreshResult; detail: string } | null = null

    for (const zone of zones) {
      let zoneIngested = 0
      try {
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const found = await source.search({
            zoneKey: zone.zoneKey,
            category: zone.category,
            page,
          })
          const saved = await this.comparables.upsertMany(
            source.source,
            zone.zoneKey,
            zone.category,
            found.items,
            now,
          )
          created += saved.created
          updated += saved.updated
          zoneIngested += saved.created + saved.updated
          if (!found.hasMore) break
        }
        push(
          zoneResults,
          zone.id,
          zoneIngested > 0 ? RefreshResult.OK : RefreshResult.EMPTY,
        )
      } catch (error) {
        const blocked = error instanceof SourceBlockedError
        const result = blocked
          ? RefreshResult.BLOCKED
          : RefreshResult.PARSE_ERROR
        failure = { result, detail: errorMessage(error) }
        push(zoneResults, zone.id, result)
        this.logger.warn(
          {
            source: source.source,
            zone: zone.zoneKey,
            result,
            error: errorMessage(error),
          },
          'La fuente falló: se corta para el resto de la corrida',
        )
        // No se insiste contra un bloqueo ni contra un parser roto (se rompería igual en cada zona).
        if (blocked || error instanceof SourceParseError) break
      }
    }

    if (failure) {
      return {
        source: source.source,
        result: failure.result,
        created,
        updated,
        detail: failure.detail,
      }
    }
    return {
      source: source.source,
      result: created + updated > 0 ? RefreshResult.OK : RefreshResult.EMPTY,
      created,
      updated,
      detail: null,
    }
  }

  /**
   * Avisa, una vez por día y fuente, a las inmobiliarias que tasaron en los
   * últimos 30 días que una fuente dejó de traer datos (rediseño 4.1).
   */
  async notifyStale(sources: MarketSource[], now: Date): Promise<void> {
    if (sources.length === 0) return
    const since = new Date(now.getTime() - ACTIVE_APPRAISER_DAYS * DAY_MS)
    const today = toIsoDate(now)
    for (const tenant of await this.tenants.listActive()) {
      await RequestContext.runInTenant(tenant.id, async () => {
        if ((await this.requests.countSince(since)) === 0) return
        for (const source of sources) {
          await this.notifications.notifyStaff({
            tenantId: tenant.id,
            type: 'COMPARABLES_SOURCE_STALE',
            title: 'Datos de mercado desactualizados',
            body: `La fuente ${source} lleva varias corridas sin traer avisos nuevos. Las sugerencias de precio pueden estar basadas en datos viejos.`,
            dedupeKey: `COMPARABLES_SOURCE_STALE:${source}:${today}`,
            link: '/propiedades',
          })
        }
      })
    }
  }
}

function push(
  map: Map<string, RefreshResult[]>,
  key: string,
  value: RefreshResult,
) {
  map.set(key, [...(map.get(key) ?? []), value])
}

function emptyState(source: MarketSource): SourceState {
  return {
    source,
    lastRunAt: null,
    lastIngestAt: null,
    lastResult: null,
    consecutiveFailures: 0,
    blockedUntil: null,
  }
}

/** Una corrida sin datos nuevos, bloqueada o con parser roto suma una falla; con datos, las borra. */
export function nextState(
  previous: SourceState,
  summary: SourceRunSummary,
  now: Date,
): SourceState {
  const result = summary.result as RefreshResult
  const ok = result === RefreshResult.OK
  return {
    source: previous.source,
    lastRunAt: now,
    lastIngestAt: ok ? now : previous.lastIngestAt,
    lastResult: result,
    consecutiveFailures: ok ? 0 : previous.consecutiveFailures + 1,
    blockedUntil:
      result === RefreshResult.BLOCKED
        ? new Date(now.getTime() + SOURCE_BLOCK_HOURS * HOUR_MS)
        : null,
  }
}

/** OK si alguna fuente trajo datos; BLOCKED si todas bloquearon; si no, el error o EMPTY. */
export function zoneResultOf(results: RefreshResult[]): RefreshResult {
  if (results.includes(RefreshResult.OK)) return RefreshResult.OK
  if (results.every((r) => r === RefreshResult.BLOCKED)) {
    return RefreshResult.BLOCKED
  }
  if (results.includes(RefreshResult.PARSE_ERROR)) {
    return RefreshResult.PARSE_ERROR
  }
  return RefreshResult.EMPTY
}
