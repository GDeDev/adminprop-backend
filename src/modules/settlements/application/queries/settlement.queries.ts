import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import { SettlementStatus } from '../../domain/settlement'
import { SettlementRepository } from '../../domain/settlement.ports'
import { SettlementReferences } from '../settlement-references'
import {
  SettlementDetailView,
  SettlementSummaryView,
  SettlementViews,
} from '../settlement.views'

export class ListSettlementsQuery {
  constructor(
    public readonly filter: {
      ownerId?: string
      propertyId?: string
      contractId?: string
      period?: string
      status?: SettlementStatus
    },
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetSettlementQuery {
  constructor(public readonly id: string) {}
}

/** Listado paginado (5). */
@QueryHandler(ListSettlementsQuery)
export class ListSettlementsHandler implements IQueryHandler<
  ListSettlementsQuery,
  PaginatedResult<SettlementSummaryView>
> {
  constructor(
    private readonly settlements: SettlementRepository,
    private readonly views: SettlementViews,
  ) {}

  execute(
    query: ListSettlementsQuery,
  ): Promise<PaginatedResult<SettlementSummaryView>> {
    return paginateWith(query.page, async (page) => {
      const [settlements, total] = await this.settlements.list(
        query.filter,
        page,
      )
      return [await this.views.summaries(settlements), total]
    })
  }
}

/** La ficha. Un id de otra inmobiliaria da el mismo 404 que uno inexistente. */
@QueryHandler(GetSettlementQuery)
export class GetSettlementHandler implements IQueryHandler<
  GetSettlementQuery,
  SettlementDetailView
> {
  constructor(
    private readonly references: SettlementReferences,
    private readonly views: SettlementViews,
  ) {}

  async execute(query: GetSettlementQuery): Promise<SettlementDetailView> {
    return this.views.detail(await this.references.requireSettlement(query.id))
  }
}
