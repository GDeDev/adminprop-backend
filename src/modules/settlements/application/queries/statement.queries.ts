import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { OwnersFacade } from '@/modules/owners/public'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import {
  FeeReceivableStatus,
  SettlementStatus,
  StatementStatus,
} from '../../domain/settlement'
import {
  StatementInvalidOwnerException,
  StatementNotFoundException,
} from '../../domain/settlement.exceptions'
import {
  FeePaymentRepository,
  FeeReceivableRepository,
  OwnerStatementRepository,
  SettlementRepository,
} from '../../domain/settlement.ports'
import { FeeReceivableView, FeeViews, OwnerFeeAccountView } from '../fee.views'
import { SettlementSummaryView, SettlementViews } from '../settlement.views'
import {
  OwnerStatementDetailView,
  OwnerStatementSummaryView,
  StatementViews,
} from '../statement.views'

export class ListStatementsQuery {
  constructor(
    public readonly filter: {
      ownerId?: string
      period?: string
      status?: StatementStatus
    },
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetStatementQuery {
  constructor(public readonly id: string) {}
}

/** Las liquidaciones del propietario que todavía se pueden consolidar. */
export class ListStatementCandidatesQuery {
  constructor(public readonly statementId: string) {}
}

export class ListFeeReceivablesQuery {
  constructor(
    public readonly filter: {
      ownerId?: string
      contractId?: string
      status?: FeeReceivableStatus
    },
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetOwnerFeeAccountQuery {
  constructor(public readonly ownerId: string) {}
}

@QueryHandler(ListStatementsQuery)
export class ListStatementsHandler implements IQueryHandler<
  ListStatementsQuery,
  PaginatedResult<OwnerStatementSummaryView>
> {
  constructor(
    private readonly statements: OwnerStatementRepository,
    private readonly views: StatementViews,
  ) {}

  execute(
    query: ListStatementsQuery,
  ): Promise<PaginatedResult<OwnerStatementSummaryView>> {
    return paginateWith(query.page, async (page) => {
      const [statements, total] = await this.statements.list(query.filter, page)
      return [await this.views.summaries(statements), total]
    })
  }
}

@QueryHandler(GetStatementQuery)
export class GetStatementHandler implements IQueryHandler<
  GetStatementQuery,
  OwnerStatementDetailView
> {
  constructor(
    private readonly statements: OwnerStatementRepository,
    private readonly views: StatementViews,
  ) {}

  async execute(query: GetStatementQuery): Promise<OwnerStatementDetailView> {
    const statement = await this.statements.findById(query.id)
    if (!statement) throw new StatementNotFoundException(query.id)
    return this.views.detail(statement)
  }
}

/** Confirmadas o transferidas del propietario, sin consolidado (pantalla de cierre). */
@QueryHandler(ListStatementCandidatesQuery)
export class ListStatementCandidatesHandler implements IQueryHandler<
  ListStatementCandidatesQuery,
  SettlementSummaryView[]
> {
  constructor(
    private readonly statements: OwnerStatementRepository,
    private readonly settlements: SettlementRepository,
    private readonly views: SettlementViews,
  ) {}

  async execute(
    query: ListStatementCandidatesQuery,
  ): Promise<SettlementSummaryView[]> {
    const statement = await this.statements.findById(query.statementId)
    if (!statement) throw new StatementNotFoundException(query.statementId)
    const candidates = await this.settlements.listAll({
      ownerId: statement.ownerId,
      statuses: [SettlementStatus.CONFIRMED, SettlementStatus.TRANSFERRED],
      statementId: null,
    })
    return this.views.summaries(candidates)
  }
}

@QueryHandler(ListFeeReceivablesQuery)
export class ListFeeReceivablesHandler implements IQueryHandler<
  ListFeeReceivablesQuery,
  PaginatedResult<FeeReceivableView>
> {
  constructor(
    private readonly receivables: FeeReceivableRepository,
    private readonly views: FeeViews,
  ) {}

  execute(
    query: ListFeeReceivablesQuery,
  ): Promise<PaginatedResult<FeeReceivableView>> {
    return paginateWith(query.page, async (page) => {
      const [receivables, total] = await this.receivables.list(
        query.filter,
        page,
      )
      return [await this.views.receivables(receivables), total]
    })
  }
}

/** La cuenta de honorarios de un propietario (4.8). */
@QueryHandler(GetOwnerFeeAccountQuery)
export class GetOwnerFeeAccountHandler implements IQueryHandler<
  GetOwnerFeeAccountQuery,
  OwnerFeeAccountView
> {
  constructor(
    private readonly owners: OwnersFacade,
    private readonly receivables: FeeReceivableRepository,
    private readonly payments: FeePaymentRepository,
    private readonly views: FeeViews,
  ) {}

  async execute(query: GetOwnerFeeAccountQuery): Promise<OwnerFeeAccountView> {
    if (!(await this.owners.exists(query.ownerId))) {
      throw new StatementInvalidOwnerException(query.ownerId)
    }
    const [receivables, payments] = await Promise.all([
      this.receivables.listAll({ ownerId: query.ownerId }),
      this.payments.listAll({ ownerId: query.ownerId }, 'newest'),
    ])
    return this.views.account(query.ownerId, receivables, payments)
  }
}
