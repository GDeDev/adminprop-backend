import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { ActiveFilter } from '@/modules/master-data/domain/catalog'
import { Location, LocationNode } from '@/modules/master-data/domain/location'
import { LocationNotFoundException } from '@/modules/master-data/domain/master-data.exceptions'
import { MasterDataPolicy } from '@/modules/master-data/domain/master-data.policy'
import {
  LocationFilter,
  LocationRepository,
} from '@/modules/master-data/domain/master-data.repositories'

export class ListLocationsQuery {
  constructor(public readonly filter: LocationFilter) {}
}

export class GetLocationQuery {
  constructor(public readonly id: string) {}
}

export class GetLocationTreeQuery {
  constructor(public readonly active: ActiveFilter) {}
}

/** Para los selects en cascada: provincia → localidades → barrios. */
@QueryHandler(ListLocationsQuery)
export class ListLocationsHandler implements IQueryHandler<
  ListLocationsQuery,
  Location[]
> {
  constructor(private readonly locations: LocationRepository) {}

  execute(query: ListLocationsQuery): Promise<Location[]> {
    return this.locations.list(query.filter)
  }
}

@QueryHandler(GetLocationQuery)
export class GetLocationHandler implements IQueryHandler<
  GetLocationQuery,
  Location
> {
  constructor(private readonly locations: LocationRepository) {}

  async execute(query: GetLocationQuery): Promise<Location> {
    const location = await this.locations.findById(query.id)
    if (!location) throw new LocationNotFoundException(query.id)
    return location
  }
}

/**
 * El árbol completo para la pantalla de administración. Se arma en memoria
 * desde una sola consulta: son cientos de filas, no millones.
 */
@QueryHandler(GetLocationTreeQuery)
export class GetLocationTreeHandler implements IQueryHandler<
  GetLocationTreeQuery,
  LocationNode[]
> {
  constructor(private readonly locations: LocationRepository) {}

  async execute(query: GetLocationTreeQuery): Promise<LocationNode[]> {
    const all = await this.locations.list({ active: query.active })
    return MasterDataPolicy.buildTree(all)
  }
}
