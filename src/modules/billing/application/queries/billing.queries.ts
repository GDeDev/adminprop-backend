import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { todayIso } from '@/shared/dates/calendar-date'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import {
  CollectionMode,
  InstallmentStatus,
  PaymentReceiver,
  PaymentStatus,
} from '../../domain/billing'
import {
  InstallmentFilter,
  InstallmentRepository,
  PaymentRepository,
  RenterCreditRepository,
} from '../../domain/billing.ports'
import { InstallmentPolicy } from '../../domain/installment.policy'
import { BillingReferences } from '../billing-references'
import {
  buildContractAccount,
  ContractAccountView,
} from '../contract-account.views'
import {
  BillingSummaryView,
  InstallmentBreakdownView,
  InstallmentDetailView,
  InstallmentSummaryView,
  InstallmentViews,
  PaymentListItemView,
  RenterArrearsView,
  RenterCreditsView,
} from '../installment.views'

export class ListInstallmentsQuery {
  constructor(
    public readonly filter: {
      period?: string
      status?: InstallmentStatus
      contractId?: string
      renterId?: string
      propertyId?: string
      ownerId?: string
      collectionMode?: CollectionMode
    },
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetBillingSummaryQuery {
  constructor(public readonly period: string) {}
}

export class GetInstallmentQuery {
  constructor(public readonly id: string) {}
}

export class GetInstallmentBreakdownQuery {
  constructor(
    public readonly id: string,
    public readonly asOf: string | undefined,
  ) {}
}

export class GetContractAccountQuery {
  constructor(public readonly contractId: string) {}
}

export class ListPaymentsQuery {
  constructor(
    public readonly filter: {
      contractId?: string
      renterId?: string
      status?: PaymentStatus
      receivedBy?: PaymentReceiver
      from?: string
      to?: string
    },
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class ListRenterCreditsQuery {
  constructor(public readonly renterId: string) {}
}

export class GetArrearsQuery {
  constructor(public readonly renterIds: string[]) {}
}

/**
 * Listado del mes (spec 3.2). `OVERDUE` no está guardado (D-71): se traduce
 * a "no saldada y gracia vencida a hoy"; `PENDING`/`PARTIAL` excluyen las
 * vencidas para que los filtros partan el listado sin superponerse.
 */
@QueryHandler(ListInstallmentsQuery)
export class ListInstallmentsHandler implements IQueryHandler<
  ListInstallmentsQuery,
  PaginatedResult<InstallmentSummaryView>
> {
  constructor(
    private readonly installments: InstallmentRepository,
    private readonly views: InstallmentViews,
  ) {}

  async execute(
    query: ListInstallmentsQuery,
  ): Promise<PaginatedResult<InstallmentSummaryView>> {
    const today = todayIso()
    const { period, status, ...rest } = query.filter
    const filter: InstallmentFilter = {
      ...rest,
      ...(period ? { period: InstallmentPolicy.normalizePeriod(period) } : {}),
      status,
    }
    if (status === InstallmentStatus.OVERDUE) {
      filter.unpaidGraceEndBefore = today
    } else if (
      status === InstallmentStatus.PENDING ||
      status === InstallmentStatus.PARTIAL
    ) {
      filter.graceEndFrom = today
    }
    return paginateWith(query.page, async (page) => {
      const [installments, total] = await this.installments.list(filter, page)
      return [await this.views.summaries(installments, today), total]
    })
  }
}

/** Resumen del mes por moneda (5). */
@QueryHandler(GetBillingSummaryQuery)
export class GetBillingSummaryHandler implements IQueryHandler<
  GetBillingSummaryQuery,
  BillingSummaryView
> {
  constructor(
    private readonly installments: InstallmentRepository,
    private readonly views: InstallmentViews,
  ) {}

  async execute(query: GetBillingSummaryQuery): Promise<BillingSummaryView> {
    const period = InstallmentPolicy.normalizePeriod(query.period)
    const installments = await this.installments.listAll({ period })
    return this.views.summary(period, installments)
  }
}

/** La ficha. Un id de otra inmobiliaria da el mismo 404 que uno inexistente. */
@QueryHandler(GetInstallmentQuery)
export class GetInstallmentHandler implements IQueryHandler<
  GetInstallmentQuery,
  InstallmentDetailView
> {
  constructor(
    private readonly references: BillingReferences,
    private readonly views: InstallmentViews,
  ) {}

  async execute(query: GetInstallmentQuery): Promise<InstallmentDetailView> {
    return this.views.detail(await this.references.requireInstallment(query.id))
  }
}

/** Spec 3.4: el desglose a una fecha, recalculado al momento. */
@QueryHandler(GetInstallmentBreakdownQuery)
export class GetInstallmentBreakdownHandler implements IQueryHandler<
  GetInstallmentBreakdownQuery,
  InstallmentBreakdownView
> {
  constructor(
    private readonly references: BillingReferences,
    private readonly views: InstallmentViews,
  ) {}

  async execute(
    query: GetInstallmentBreakdownQuery,
  ): Promise<InstallmentBreakdownView> {
    const today = todayIso()
    const asOf = InstallmentPolicy.normalizeAsOf(query.asOf, today)
    const installment = await this.references.requireInstallment(query.id)
    return this.views.breakdown(installment, asOf, today)
  }
}

/** Cuenta corriente del contrato (Micaela #8), en cualquier estado del contrato. */
@QueryHandler(GetContractAccountQuery)
export class GetContractAccountHandler implements IQueryHandler<
  GetContractAccountQuery,
  ContractAccountView
> {
  constructor(
    private readonly references: BillingReferences,
    private readonly installments: InstallmentRepository,
    private readonly credits: RenterCreditRepository,
  ) {}

  async execute(query: GetContractAccountQuery): Promise<ContractAccountView> {
    const contract = await this.references.requireContract(query.contractId)
    const [installments, credits] = await Promise.all([
      this.installments.listAll({ contractId: contract.id }),
      this.credits.listByContract(contract.id),
    ])
    return buildContractAccount(contract, installments, credits, todayIso())
  }
}

/** Pagos de la inmobiliaria (pantalla de pendientes de confirmación). */
@QueryHandler(ListPaymentsQuery)
export class ListPaymentsHandler implements IQueryHandler<
  ListPaymentsQuery,
  PaginatedResult<PaymentListItemView>
> {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly installments: InstallmentRepository,
    private readonly views: InstallmentViews,
  ) {}

  async execute(
    query: ListPaymentsQuery,
  ): Promise<PaginatedResult<PaymentListItemView>> {
    const { from, to, ...rest } = query.filter
    const today = todayIso()
    const filter = {
      ...rest,
      from: from ? InstallmentPolicy.normalizeAsOf(from, today) : undefined,
      to: to ? InstallmentPolicy.normalizeAsOf(to, today) : undefined,
    }
    return paginateWith(query.page, async (page) => {
      const [payments, total] = await this.payments.list(filter, page)
      const installments =
        payments.length === 0
          ? []
          : await this.installments.listAll({
              ids: [...new Set(payments.map((p) => p.installmentId))],
            })
      return [await this.views.paymentList(payments, installments), total]
    })
  }
}

/** Saldos a favor de un inquilino: disponibles, aplicados, devueltos. */
@QueryHandler(ListRenterCreditsQuery)
export class ListRenterCreditsHandler implements IQueryHandler<
  ListRenterCreditsQuery,
  RenterCreditsView
> {
  constructor(
    private readonly references: BillingReferences,
    private readonly credits: RenterCreditRepository,
    private readonly views: InstallmentViews,
  ) {}

  async execute(query: ListRenterCreditsQuery): Promise<RenterCreditsView> {
    await this.references.requireRenter(query.renterId)
    const credits = await this.credits.listByRenter(query.renterId)
    return this.views.credits(query.renterId, credits)
  }
}

/** Mora por inquilino (spec 5.2): una fila por id pedido. */
@QueryHandler(GetArrearsQuery)
export class GetArrearsHandler implements IQueryHandler<
  GetArrearsQuery,
  RenterArrearsView[]
> {
  constructor(
    private readonly installments: InstallmentRepository,
    private readonly views: InstallmentViews,
  ) {}

  async execute(query: GetArrearsQuery): Promise<RenterArrearsView[]> {
    const renterIds = [...new Set(query.renterIds)]
    if (renterIds.length === 0) return []
    const today = todayIso()
    const unpaid = await this.installments.listAll({
      renterIds,
      unpaid: true,
    })
    return this.views.arrears(renterIds, unpaid, today)
  }
}
