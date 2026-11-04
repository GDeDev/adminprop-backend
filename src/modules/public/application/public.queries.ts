import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import {
  ListingCurrency,
  ListingOperation,
  PropertiesFacade,
  PublicFiltersView,
  PublicPropertyDetailView,
  PublicPropertySummaryView,
} from '@/modules/properties/public'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import { PublicInquiryStatus } from '../domain/public-inquiry'
import { PropertyNotAvailableException } from '../domain/public.exceptions'
import { PublicInquiryRepository } from '../domain/public.ports'
import { PublicTenantScope } from './public-tenant-scope'
import { PublicInquiryView, PublicInquiryViews } from './public.views'

export interface PublicListingFilter {
  locationId?: string
  propertyTypeId?: string
  priceFrom?: string
  priceTo?: string
  currency?: ListingCurrency
  operation?: ListingOperation
  bedroomsMin?: number
  bathroomsMin?: number
  ids?: string[]
}

export class ListPublicPropertiesQuery {
  constructor(
    public readonly slug: string,
    public readonly filter: PublicListingFilter,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetPublicPropertyQuery {
  constructor(
    public readonly slug: string,
    public readonly id: string,
  ) {}
}

export class GetPublicFiltersQuery {
  constructor(public readonly slug: string) {}
}

export class ListPublicInquiriesQuery {
  constructor(
    public readonly filter: {
      status?: PublicInquiryStatus
      propertyId?: string
    },
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

@QueryHandler(ListPublicPropertiesQuery)
export class ListPublicPropertiesHandler implements IQueryHandler<
  ListPublicPropertiesQuery,
  PaginatedResult<PublicPropertySummaryView>
> {
  constructor(
    private readonly scope: PublicTenantScope,
    private readonly properties: PropertiesFacade,
  ) {}

  execute({
    slug,
    filter,
    page,
  }: ListPublicPropertiesQuery): Promise<
    PaginatedResult<PublicPropertySummaryView>
  > {
    return this.scope.run(slug, (tenant) => {
      const hasPrice =
        filter.priceFrom !== undefined || filter.priceTo !== undefined
      return this.properties.listPublic(
        {
          ...filter,
          // Un rango de precio sin moneda no se puede comparar: se toma la de la inmobiliaria.
          currency:
            filter.currency ??
            (hasPrice
              ? (tenant.defaultCurrency as ListingCurrency)
              : undefined),
        },
        page,
      )
    })
  }
}

/** 404 `PROPERTY_NOT_AVAILABLE` si no existe, es de otra inmobiliaria o ya no está disponible. */
@QueryHandler(GetPublicPropertyQuery)
export class GetPublicPropertyHandler implements IQueryHandler<
  GetPublicPropertyQuery,
  PublicPropertyDetailView
> {
  constructor(
    private readonly scope: PublicTenantScope,
    private readonly properties: PropertiesFacade,
  ) {}

  execute({
    slug,
    id,
  }: GetPublicPropertyQuery): Promise<PublicPropertyDetailView> {
    return this.scope.run(slug, async () => {
      const property = await this.properties.getPublic(id)
      if (!property) throw new PropertyNotAvailableException()
      return property
    })
  }
}

@QueryHandler(GetPublicFiltersQuery)
export class GetPublicFiltersHandler implements IQueryHandler<
  GetPublicFiltersQuery,
  PublicFiltersView
> {
  constructor(
    private readonly scope: PublicTenantScope,
    private readonly properties: PropertiesFacade,
  ) {}

  execute({ slug }: GetPublicFiltersQuery): Promise<PublicFiltersView> {
    return this.scope.run(slug, () => this.properties.publicFilters())
  }
}

@QueryHandler(ListPublicInquiriesQuery)
export class ListPublicInquiriesHandler implements IQueryHandler<
  ListPublicInquiriesQuery,
  PaginatedResult<PublicInquiryView>
> {
  constructor(
    private readonly inquiries: PublicInquiryRepository,
    private readonly views: PublicInquiryViews,
  ) {}

  execute(
    query: ListPublicInquiriesQuery,
  ): Promise<PaginatedResult<PublicInquiryView>> {
    return paginateWith(query.page, async (page) => {
      const [items, total] = await this.inquiries.list(query.filter, page)
      return [await this.views.of(items), total]
    })
  }
}
