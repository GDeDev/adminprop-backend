import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import {
  ListingCurrency,
  ListingOperation,
  PropertiesFacade,
  PublicFiltersView,
  PublicPropertySort,
  PublicPropertyDetailView,
  PublicPropertySummaryView,
} from '@/modules/properties/public'
import { CrmFacade } from '@/modules/crm/public'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { PropertyNotAvailableException } from '../domain/public.exceptions'
import { PublicTenantScope } from './public-tenant-scope'

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
  sort?: PublicPropertySort
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
    /** Para contar la vista (A-83); nunca se guarda. */
    public readonly visitor: { ip: string | null; userAgent: string | null } = {
      ip: null,
      userAgent: null,
    },
  ) {}
}

export class GetPublicFiltersQuery {
  constructor(public readonly slug: string) {}
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
    private readonly crm: CrmFacade,
  ) {}

  execute({
    slug,
    id,
    visitor,
  }: GetPublicPropertyQuery): Promise<PublicPropertyDetailView> {
    return this.scope.run(slug, async () => {
      const property = await this.properties.getPublic(id)
      if (!property) throw new PropertyNotAvailableException()
      await this.crm.recordPropertyView(id, visitor)
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
