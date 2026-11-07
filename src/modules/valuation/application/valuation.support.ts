import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Catalog, MasterDataFacade } from '@/modules/master-data/public'
import { Configuration } from '@/shared/config/configuration'
import { categoryOfPropertyType } from '../domain/market-category'
import { MarketCategory } from '../domain/market'
import { buildZoneKey, buildZoneLabel, parentZoneKey } from '../domain/zone-key'

/** Antigüedad máxima de un aviso sin verse antes de darlo de baja (rediseño 4.1). */
export const INACTIVE_AFTER_DAYS = 30
/** Una zona se corre a lo sumo una vez cada 24 h (rediseño 4). */
export const ZONE_REFRESH_INTERVAL_HOURS = 24
/** Una fuente cortada por bloqueo no se toca por 24 h. */
export const SOURCE_BLOCK_HOURS = 24
/** Corridas seguidas sin datos que se toleran antes de avisar (rediseño 4.1). */
export const STALE_AFTER_FAILURES = 3
/** Una tasación idéntica dentro de esta ventana se reutiliza (A-67). */
export const REUSE_WINDOW_HOURS = 6
/** Las inmobiliarias que tasaron en este lapso reciben el aviso de fuente rota. */
export const ACTIVE_APPRAISER_DAYS = 30

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS

/** La configuración de la tasación, ya con sus defaults. */
@Injectable()
export class ValuationSettings {
  constructor(private readonly config: ConfigService<Configuration, true>) {}

  get values() {
    return this.config.get('valuation', { infer: true })
  }

  get maxAgeDays(): number {
    return this.values.maxAgeDays
  }

  get minComparables(): number {
    return this.values.minComparables
  }

  seenSince(now: Date): Date {
    return new Date(now.getTime() - this.maxAgeDays * DAY_MS)
  }
}

export interface ResolvedZone {
  zoneKey: string
  label: string
  parent: { zoneKey: string; label: string } | null
}

/**
 * De una ubicación (por inmobiliaria) a su zona de mercado (global, A-61), y
 * de un tipo de propiedad a su categoría.
 */
@Injectable()
export class ZoneResolver {
  constructor(private readonly masterData: MasterDataFacade) {}

  /** null si la ubicación no existe o no tiene nombres usables. */
  async resolveLocation(locationId: string): Promise<ResolvedZone | null> {
    const names = await this.masterData.locationNames(locationId)
    return names ? zoneOfNames(names) : null
  }

  /** Categoría de mercado de cada tipo de propiedad pedido. */
  async categoriesOf(
    propertyTypeIds: string[],
  ): Promise<Map<string, MarketCategory>> {
    const types = await this.masterData.describeCatalog(
      Catalog.PROPERTY_TYPES,
      propertyTypeIds,
    )
    return new Map(
      propertyTypeIds.map((id) => [
        id,
        categoryOfPropertyType(types.get(id)?.name ?? ''),
      ]),
    )
  }
}

export function zoneOfNames(names: string[]): ResolvedZone | null {
  const zoneKey = buildZoneKey(names)
  if (!zoneKey) return null
  const parentKey = parentZoneKey(zoneKey)
  return {
    zoneKey,
    label: buildZoneLabel(names),
    parent: parentKey
      ? {
          zoneKey: parentKey,
          label: buildZoneLabel(names.slice(0, names.length - 1)),
        }
      : null,
  }
}
