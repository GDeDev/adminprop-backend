import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import {
  ContractStatus,
  currentRentOf,
} from '@/modules/contracts/domain/contract'
import {
  ContractNotActiveException,
  ContractNotFoundException,
} from '@/modules/contracts/domain/contract.exceptions'
import {
  ContractPolicy,
  TerminationBreakdown,
} from '@/modules/contracts/domain/contract.policy'
import {
  ContractFilter,
  ContractRepository,
} from '@/modules/contracts/domain/contract.ports'
import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { addDays, todayIso } from '@/shared/dates/calendar-date'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import {
  ContractDetailView,
  ContractSummaryView,
  ContractViews,
} from '../contract.views'

export class ListContractsQuery {
  constructor(
    public readonly filter: Omit<ContractFilter, 'endDateBetween'> & {
      /** Activos que vencen dentro de los días de aviso de la inmobiliaria. */
      expiringSoon?: boolean
    },
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetContractQuery {
  constructor(public readonly id: string) {}
}

/** Spec 5.4: el desglose de la multa antes de confirmar la rescisión. */
export class PreviewTerminationQuery {
  constructor(
    public readonly id: string,
    public readonly notifiedAt: string,
  ) {}
}

@QueryHandler(ListContractsQuery)
export class ListContractsHandler implements IQueryHandler<
  ListContractsQuery,
  PaginatedResult<ContractSummaryView>
> {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly tenants: TenantsFacade,
    private readonly views: ContractViews,
  ) {}

  async execute(
    query: ListContractsQuery,
  ): Promise<PaginatedResult<ContractSummaryView>> {
    const { expiringSoon, ...rest } = query.filter
    const filter: ContractFilter = { ...rest }
    if (expiringSoon) {
      const today = todayIso()
      filter.status = ContractStatus.ACTIVE
      filter.endDateBetween = {
        from: today,
        to: addDays(today, await this.noticeDays()),
      }
    }
    return paginateWith(query.page, async (page) => {
      const [contracts, total] = await this.contracts.list(filter, page)
      return [await this.views.summaries(contracts), total]
    })
  }

  private async noticeDays(): Promise<number> {
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Consulta de contratos fuera de un tenant')
    return (await this.tenants.getContractSettings(tenantId))
      .contractExpiryNoticeDays
  }
}

/** La ficha. Un id de otra inmobiliaria da el mismo 404 que uno inexistente. */
@QueryHandler(GetContractQuery)
export class GetContractHandler implements IQueryHandler<
  GetContractQuery,
  ContractDetailView
> {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly views: ContractViews,
  ) {}

  async execute(query: GetContractQuery): Promise<ContractDetailView> {
    const contract = await this.contracts.findById(query.id)
    if (!contract) throw new ContractNotFoundException(query.id)
    return this.views.detail(contract)
  }
}

/** Mismas reglas y misma cuenta que la rescisión, sin tocar nada. */
@QueryHandler(PreviewTerminationQuery)
export class PreviewTerminationHandler implements IQueryHandler<
  PreviewTerminationQuery,
  TerminationBreakdown
> {
  constructor(private readonly contracts: ContractRepository) {}

  async execute(query: PreviewTerminationQuery): Promise<TerminationBreakdown> {
    const contract = await this.contracts.findById(query.id)
    if (!contract) throw new ContractNotFoundException(query.id)
    if (contract.status !== ContractStatus.ACTIVE) {
      throw new ContractNotActiveException(contract.status)
    }
    const notifiedAt = ContractPolicy.normalizeDate(
      query.notifiedAt,
      'notifiedAt',
    )
    ContractPolicy.assertTerminationDate(
      notifiedAt,
      contract.startDate,
      contract.endDate,
    )
    return ContractPolicy.termination(
      currentRentOf(contract),
      notifiedAt,
      contract.endDate,
    )
  }
}
