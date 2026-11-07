import { PaginationQueryDto } from '@/shared/pagination'
import { MarketCurrency } from '../domain/market'

export interface AppraiseInput {
  /** Decimal como string. */
  areaM2?: string
  bedrooms?: number
  /** Textos libres; por defecto los de la propiedad. */
  amenities?: string[]
  /** Por defecto, la moneda de publicación de la propiedad. */
  currency?: MarketCurrency
}

export class AppraisePropertyCommand {
  constructor(
    public readonly propertyId: string,
    public readonly input: AppraiseInput,
  ) {}
}

/** Encola el refresco de la zona de esa ubicación; responde con el id del AsyncJob. */
export class RefreshZoneCommand {
  constructor(public readonly locationId: string) {}
}

export class ListAppraisalsQuery {
  constructor(
    public readonly propertyId: string,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetMarketStatusQuery {}

export class GetMarketCoverageQuery {
  constructor(public readonly locationId: string) {}
}
