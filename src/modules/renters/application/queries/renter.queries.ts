import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { fullNameOf } from '@/modules/renters/domain/renter'
import { RenterNotFoundException } from '@/modules/renters/domain/renter.exceptions'
import {
  RenterFilter,
  RenterRef,
  RenterRepository,
} from '@/modules/renters/domain/renter.ports'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import { PersonPolicy } from '@/shared/people/person-policy'
import {
  RenterDetailView,
  RenterSummaryView,
  RenterViews,
} from '../renter.views'

export class ListRentersQuery {
  constructor(
    public readonly filter: RenterFilter,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetRenterQuery {
  constructor(public readonly id: string) {}
}

/** Chequeo en vivo del formulario: si el DNI ya está tomado. */
export class CheckRenterDataQuery {
  constructor(
    public readonly nationalId?: string,
    /** En una edición, el propio inquilino no cuenta como duplicado. */
    public readonly excludeId?: string,
  ) {}
}

export interface RenterDataCheck {
  /** Null si el DNI está libre o no se preguntó. */
  nationalIdTakenBy: RenterRef | null
}

@QueryHandler(ListRentersQuery)
export class ListRentersHandler implements IQueryHandler<
  ListRentersQuery,
  PaginatedResult<RenterSummaryView>
> {
  constructor(
    private readonly renters: RenterRepository,
    private readonly views: RenterViews,
  ) {}

  execute(
    query: ListRentersQuery,
  ): Promise<PaginatedResult<RenterSummaryView>> {
    return paginateWith(query.page, async (page) => {
      const [renters, total] = await this.renters.list(query.filter, page)
      return [await this.views.summaries(renters), total]
    })
  }
}

/** La ficha. Un id de otra inmobiliaria da el mismo 404 que uno inexistente. */
@QueryHandler(GetRenterQuery)
export class GetRenterHandler implements IQueryHandler<
  GetRenterQuery,
  RenterDetailView
> {
  constructor(
    private readonly renters: RenterRepository,
    private readonly views: RenterViews,
  ) {}

  async execute(query: GetRenterQuery): Promise<RenterDetailView> {
    const renter = await this.renters.findById(query.id)
    if (!renter) throw new RenterNotFoundException(query.id)
    return this.views.detail(renter)
  }
}

@QueryHandler(CheckRenterDataQuery)
export class CheckRenterDataHandler implements IQueryHandler<
  CheckRenterDataQuery,
  RenterDataCheck
> {
  constructor(private readonly renters: RenterRepository) {}

  async execute(query: CheckRenterDataQuery): Promise<RenterDataCheck> {
    // Un DNI a medio tipear no es un error: simplemente no se chequea.
    const nationalId = query.nationalId
      ? PersonPolicy.parseNationalId(query.nationalId)
      : null
    const holder = nationalId
      ? await this.renters.findByNationalId(nationalId)
      : null

    return {
      nationalIdTakenBy:
        holder && holder.id !== query.excludeId
          ? { id: holder.id, fullName: fullNameOf(holder) }
          : null,
    }
  }
}
