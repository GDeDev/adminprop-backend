import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { fullNameOf } from '@/shared/people/person-policy'
import { GuarantorNotFoundException } from '@/modules/renters/domain/guarantor.exceptions'
import {
  GuarantorFilter,
  GuarantorRef,
  GuarantorRepository,
} from '@/modules/renters/domain/guarantor.ports'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import { PersonPolicy } from '@/shared/people/person-policy'
import {
  GuarantorDetailView,
  GuarantorSummaryView,
  RenterViews,
} from '../renter.views'

export class ListGuarantorsQuery {
  constructor(
    public readonly filter: GuarantorFilter,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetGuarantorQuery {
  constructor(public readonly id: string) {}
}

/**
 * Chequeo en vivo del formulario (spec 7): el autocomplete busca por DNI y,
 * si no está, ofrece crearlo.
 */
export class CheckGuarantorDataQuery {
  constructor(
    public readonly nationalId?: string,
    /** En una edición, el propio garante no cuenta como duplicado. */
    public readonly excludeId?: string,
  ) {}
}

export interface GuarantorDataCheck {
  /** Null si el DNI está libre o no se preguntó. */
  nationalIdTakenBy: GuarantorRef | null
}

@QueryHandler(ListGuarantorsQuery)
export class ListGuarantorsHandler implements IQueryHandler<
  ListGuarantorsQuery,
  PaginatedResult<GuarantorSummaryView>
> {
  constructor(
    private readonly guarantors: GuarantorRepository,
    private readonly views: RenterViews,
  ) {}

  execute(
    query: ListGuarantorsQuery,
  ): Promise<PaginatedResult<GuarantorSummaryView>> {
    return paginateWith(query.page, async (page) => {
      const [guarantors, total] = await this.guarantors.list(query.filter, page)
      return [await this.views.guarantorSummaries(guarantors), total]
    })
  }
}

/** La ficha. Un id de otra inmobiliaria da el mismo 404 que uno inexistente. */
@QueryHandler(GetGuarantorQuery)
export class GetGuarantorHandler implements IQueryHandler<
  GetGuarantorQuery,
  GuarantorDetailView
> {
  constructor(
    private readonly guarantors: GuarantorRepository,
    private readonly views: RenterViews,
  ) {}

  async execute(query: GetGuarantorQuery): Promise<GuarantorDetailView> {
    const guarantor = await this.guarantors.findById(query.id)
    if (!guarantor) throw new GuarantorNotFoundException(query.id)
    return this.views.guarantorDetail(guarantor)
  }
}

@QueryHandler(CheckGuarantorDataQuery)
export class CheckGuarantorDataHandler implements IQueryHandler<
  CheckGuarantorDataQuery,
  GuarantorDataCheck
> {
  constructor(private readonly guarantors: GuarantorRepository) {}

  async execute(query: CheckGuarantorDataQuery): Promise<GuarantorDataCheck> {
    const nationalId = query.nationalId
      ? PersonPolicy.parseNationalId(query.nationalId)
      : null
    const holder = nationalId
      ? await this.guarantors.findByNationalId(nationalId)
      : null

    return {
      nationalIdTakenBy:
        holder && holder.id !== query.excludeId
          ? { id: holder.id, fullName: fullNameOf(holder) }
          : null,
    }
  }
}
