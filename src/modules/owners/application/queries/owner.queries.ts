import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { fullNameOf } from '@/modules/owners/domain/owner'
import { OwnerNotFoundException } from '@/modules/owners/domain/owner.exceptions'
import { OwnerPolicy } from '@/modules/owners/domain/owner.policy'
import {
  OwnerFilter,
  OwnerRef,
  OwnerRepository,
} from '@/modules/owners/domain/owner.ports'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { PersonPolicy } from '@/shared/people/person-policy'
import { paginateWith } from '@/shared/pagination/pagination'
import { OwnerDetailView, OwnerSummaryView, OwnerViews } from '../owner.views'

export class ListOwnersQuery {
  constructor(
    public readonly filter: OwnerFilter,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetOwnerQuery {
  constructor(public readonly id: string) {}
}

/**
 * Chequeo en vivo del formulario (spec 5.3): si el DNI ya está tomado (eso
 * bloquea el alta) y quiénes tienen ya ese CBU (eso sólo se advierte).
 */
export class CheckOwnerDataQuery {
  constructor(
    public readonly nationalId?: string,
    public readonly cbu?: string,
    /** En una edición, el propio propietario no cuenta como duplicado. */
    public readonly excludeId?: string,
  ) {}
}

export interface OwnerDataCheck {
  /** Null si el DNI está libre o no se preguntó. */
  nationalIdTakenBy: OwnerRef | null
  /** Otros propietarios con el mismo CBU: posible carga duplicada. */
  cbuSharedWith: OwnerRef[]
}

@QueryHandler(ListOwnersQuery)
export class ListOwnersHandler implements IQueryHandler<
  ListOwnersQuery,
  PaginatedResult<OwnerSummaryView>
> {
  constructor(
    private readonly owners: OwnerRepository,
    private readonly views: OwnerViews,
  ) {}

  execute(query: ListOwnersQuery): Promise<PaginatedResult<OwnerSummaryView>> {
    return paginateWith(query.page, async (page) => {
      const [owners, total] = await this.owners.list(query.filter, page)
      return [await this.views.summaries(owners), total]
    })
  }
}

/** La ficha. Un id de otra inmobiliaria da el mismo 404 que uno inexistente. */
@QueryHandler(GetOwnerQuery)
export class GetOwnerHandler implements IQueryHandler<
  GetOwnerQuery,
  OwnerDetailView
> {
  constructor(
    private readonly owners: OwnerRepository,
    private readonly views: OwnerViews,
  ) {}

  async execute(query: GetOwnerQuery): Promise<OwnerDetailView> {
    const owner = await this.owners.findById(query.id)
    if (!owner) throw new OwnerNotFoundException(query.id)
    return this.views.detail(owner)
  }
}

@QueryHandler(CheckOwnerDataQuery)
export class CheckOwnerDataHandler implements IQueryHandler<
  CheckOwnerDataQuery,
  OwnerDataCheck
> {
  constructor(private readonly owners: OwnerRepository) {}

  async execute(query: CheckOwnerDataQuery): Promise<OwnerDataCheck> {
    const toRef = (owner: {
      id: string
      firstName: string
      lastName: string
    }) => ({ id: owner.id, fullName: fullNameOf(owner) }) satisfies OwnerRef

    // Un DNI a medio tipear no es un error: simplemente no se chequea.
    const nationalId = query.nationalId
      ? PersonPolicy.parseNationalId(query.nationalId)
      : null
    const holder = nationalId
      ? await this.owners.findByNationalId(nationalId)
      : null

    const cbu = query.cbu?.replace(/[\s-]/g, '')
    const sharing =
      cbu && OwnerPolicy.isValidCbu(cbu) ? await this.owners.findByCbu(cbu) : []

    return {
      nationalIdTakenBy:
        holder && holder.id !== query.excludeId ? toRef(holder) : null,
      cbuSharedWith: sharing
        .filter((owner) => owner.id !== query.excludeId)
        .map(toRef),
    }
  }
}
