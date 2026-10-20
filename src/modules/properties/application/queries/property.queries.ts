import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { PropertyNotFoundException } from '@/modules/properties/domain/property.exceptions'
import {
  PropertyFilter,
  PropertyRepository,
} from '@/modules/properties/domain/property.ports'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import {
  PropertyDetailView,
  PropertySummaryView,
  PropertyViews,
} from '../property.views'

export class ListPropertiesQuery {
  constructor(
    public readonly filter: PropertyFilter,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetPropertyQuery {
  constructor(public readonly id: string) {}
}

@QueryHandler(ListPropertiesQuery)
export class ListPropertiesHandler implements IQueryHandler<
  ListPropertiesQuery,
  PaginatedResult<PropertySummaryView>
> {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly views: PropertyViews,
  ) {}

  execute(
    query: ListPropertiesQuery,
  ): Promise<PaginatedResult<PropertySummaryView>> {
    return paginateWith(query.page, async (page) => {
      const [properties, total] = await this.properties.list(query.filter, page)
      return [await this.views.summaries(properties), total]
    })
  }
}

/** La ficha. Un id de otra inmobiliaria da el mismo 404 que uno inexistente. */
@QueryHandler(GetPropertyQuery)
export class GetPropertyHandler implements IQueryHandler<
  GetPropertyQuery,
  PropertyDetailView
> {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly views: PropertyViews,
  ) {}

  async execute(query: GetPropertyQuery): Promise<PropertyDetailView> {
    const property = await this.properties.findById(query.id)
    if (!property) throw new PropertyNotFoundException(query.id)
    return this.views.detail(property)
  }
}
