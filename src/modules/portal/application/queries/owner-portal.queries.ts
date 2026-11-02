import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { BillingFacade, InstallmentSummaryView } from '@/modules/billing/public'
import { ContractsFacade } from '@/modules/contracts/public'
import { OwnersFacade } from '@/modules/owners/public'
import { PropertiesFacade } from '@/modules/properties/public'
import {
  OwnerStatementDetailView,
  OwnerStatementSummaryView,
  SettlementDetailView,
  SettlementsFacade,
  SettlementSummaryView,
} from '@/modules/settlements/public'
import { periodOf, todayIso } from '@/shared/dates/calendar-date'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import {
  PortalDocumentNotReadyException,
  PortalEntityNotFoundException,
  PortalProfileNotFoundException,
} from '../../domain/portal.exceptions'
import { PortalIdentity } from '../portal-identity'
import {
  buildOwnerAccount,
  maskSettlementDetailForOwner,
  maskStatementDetailForOwner,
  toOwnerProperties,
} from '../portal.mappers'
import {
  PortalOwnerAccountView,
  PortalOwnerMeView,
  PortalOwnerPropertyView,
} from '../portal.views'

export class GetOwnerMeQuery {
  constructor(public readonly userId: string) {}
}

export class ListOwnerPropertiesQuery {
  constructor(public readonly userId: string) {}
}

export class GetOwnerAccountQuery {
  constructor(
    public readonly userId: string,
    public readonly period: string | undefined,
  ) {}
}

export class ListOwnerSettlementsQuery {
  constructor(
    public readonly userId: string,
    public readonly filter: { propertyId?: string; period?: string },
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetOwnerSettlementQuery {
  constructor(
    public readonly userId: string,
    public readonly settlementId: string,
  ) {}
}

export class GetOwnerSettlementPdfUrlQuery {
  constructor(
    public readonly userId: string,
    public readonly settlementId: string,
  ) {}
}

export class ListOwnerStatementsQuery {
  constructor(
    public readonly userId: string,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetOwnerStatementQuery {
  constructor(
    public readonly userId: string,
    public readonly statementId: string,
  ) {}
}

export class GetOwnerStatementPdfUrlQuery {
  constructor(
    public readonly userId: string,
    public readonly statementId: string,
  ) {}
}

export class ListOwnerPropertyInstallmentsQuery {
  constructor(
    public readonly userId: string,
    public readonly propertyId: string,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

const settlementNotFound = (id: string) =>
  new PortalEntityNotFoundException(
    'SETTLEMENT_NOT_FOUND',
    'La liquidación no existe',
    id,
  )

const statementNotFound = (id: string) =>
  new PortalEntityNotFoundException(
    'STATEMENT_NOT_FOUND',
    'El resumen mensual no existe',
    id,
  )

@QueryHandler(GetOwnerMeQuery)
export class GetOwnerMeHandler implements IQueryHandler<
  GetOwnerMeQuery,
  PortalOwnerMeView
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly owners: OwnersFacade,
  ) {}

  async execute(query: GetOwnerMeQuery): Promise<PortalOwnerMeView> {
    const ownerId = await this.identity.ownerId(query.userId)
    const [profile, agency] = await Promise.all([
      this.owners.portalProfile(ownerId),
      this.identity.agency(),
    ])
    if (!profile) throw new PortalProfileNotFoundException('OWNER')
    const { cbu, alias } = profile.bankAccount
    return {
      id: profile.id,
      fullName: profile.fullName,
      email: profile.email,
      bankAccount: cbu !== null || alias !== null ? profile.bankAccount : null,
      statementSendMode: profile.statementSendMode,
      agency,
    }
  }
}

/** Sus propiedades con el contrato activo y el estado de pago de la cuota del mes. */
@QueryHandler(ListOwnerPropertiesQuery)
export class ListOwnerPropertiesHandler implements IQueryHandler<
  ListOwnerPropertiesQuery,
  PortalOwnerPropertyView[]
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly properties: PropertiesFacade,
    private readonly contracts: ContractsFacade,
    private readonly billing: BillingFacade,
  ) {}

  async execute(
    query: ListOwnerPropertiesQuery,
  ): Promise<PortalOwnerPropertyView[]> {
    const ownerId = await this.identity.ownerId(query.userId)
    const [properties, contracts, installments] = await Promise.all([
      this.properties.listByOwner(ownerId),
      this.contracts.listActiveByOwner(ownerId),
      this.billing.installmentsOfOwnerForPeriod(ownerId, periodOf(todayIso())),
    ])
    return toOwnerProperties(properties, contracts, installments)
  }
}

@QueryHandler(GetOwnerAccountQuery)
export class GetOwnerAccountHandler implements IQueryHandler<
  GetOwnerAccountQuery,
  PortalOwnerAccountView
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly billing: BillingFacade,
    private readonly settlements: SettlementsFacade,
  ) {}

  async execute(query: GetOwnerAccountQuery): Promise<PortalOwnerAccountView> {
    const ownerId = await this.identity.ownerId(query.userId)
    const period = query.period ?? periodOf(todayIso())
    const [installments, [settlements], fees] = await Promise.all([
      this.billing.installmentsOfOwnerForPeriod(ownerId, period),
      this.settlements.pageForOwner(
        ownerId,
        { period },
        { skip: 0, take: 200 },
      ),
      this.settlements.feeAccountSummary(ownerId),
    ])
    return buildOwnerAccount(period, installments, settlements, fees)
  }
}

@QueryHandler(ListOwnerSettlementsQuery)
export class ListOwnerSettlementsHandler implements IQueryHandler<
  ListOwnerSettlementsQuery,
  PaginatedResult<SettlementSummaryView>
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly settlements: SettlementsFacade,
  ) {}

  async execute(
    query: ListOwnerSettlementsQuery,
  ): Promise<PaginatedResult<SettlementSummaryView>> {
    const ownerId = await this.identity.ownerId(query.userId)
    return paginateWith(query.page, (page) =>
      this.settlements.pageForOwner(ownerId, query.filter, page),
    )
  }
}

@QueryHandler(GetOwnerSettlementQuery)
export class GetOwnerSettlementHandler implements IQueryHandler<
  GetOwnerSettlementQuery,
  SettlementDetailView
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly settlements: SettlementsFacade,
  ) {}

  async execute(query: GetOwnerSettlementQuery): Promise<SettlementDetailView> {
    const ownerId = await this.identity.ownerId(query.userId)
    const settlement = await this.settlements.findForOwner(
      ownerId,
      query.settlementId,
    )
    if (!settlement) throw settlementNotFound(query.settlementId)
    return maskSettlementDetailForOwner(settlement)
  }
}

@QueryHandler(GetOwnerSettlementPdfUrlQuery)
export class GetOwnerSettlementPdfUrlHandler implements IQueryHandler<
  GetOwnerSettlementPdfUrlQuery,
  string
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly settlements: SettlementsFacade,
  ) {}

  async execute(query: GetOwnerSettlementPdfUrlQuery): Promise<string> {
    const ownerId = await this.identity.ownerId(query.userId)
    const settlement = await this.settlements.findForOwner(
      ownerId,
      query.settlementId,
    )
    if (!settlement) throw settlementNotFound(query.settlementId)
    if (!settlement.pdfUrl) {
      throw new PortalDocumentNotReadyException(query.settlementId)
    }
    return settlement.pdfUrl
  }
}

@QueryHandler(ListOwnerStatementsQuery)
export class ListOwnerStatementsHandler implements IQueryHandler<
  ListOwnerStatementsQuery,
  PaginatedResult<OwnerStatementSummaryView>
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly settlements: SettlementsFacade,
  ) {}

  async execute(
    query: ListOwnerStatementsQuery,
  ): Promise<PaginatedResult<OwnerStatementSummaryView>> {
    const ownerId = await this.identity.ownerId(query.userId)
    return paginateWith(query.page, (page) =>
      this.settlements.pageStatementsForOwner(ownerId, page),
    )
  }
}

@QueryHandler(GetOwnerStatementQuery)
export class GetOwnerStatementHandler implements IQueryHandler<
  GetOwnerStatementQuery,
  OwnerStatementDetailView
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly settlements: SettlementsFacade,
  ) {}

  async execute(
    query: GetOwnerStatementQuery,
  ): Promise<OwnerStatementDetailView> {
    const ownerId = await this.identity.ownerId(query.userId)
    const statement = await this.settlements.findStatementForOwner(
      ownerId,
      query.statementId,
    )
    if (!statement) throw statementNotFound(query.statementId)
    return maskStatementDetailForOwner(statement)
  }
}

@QueryHandler(GetOwnerStatementPdfUrlQuery)
export class GetOwnerStatementPdfUrlHandler implements IQueryHandler<
  GetOwnerStatementPdfUrlQuery,
  string
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly settlements: SettlementsFacade,
  ) {}

  async execute(query: GetOwnerStatementPdfUrlQuery): Promise<string> {
    const ownerId = await this.identity.ownerId(query.userId)
    const statement = await this.settlements.findStatementForOwner(
      ownerId,
      query.statementId,
    )
    if (!statement) throw statementNotFound(query.statementId)
    if (!statement.pdfUrl) {
      throw new PortalDocumentNotReadyException(query.statementId)
    }
    return statement.pdfUrl
  }
}

/** Historial de cuotas de una propiedad suya; una ajena es un 404. */
@QueryHandler(ListOwnerPropertyInstallmentsQuery)
export class ListOwnerPropertyInstallmentsHandler implements IQueryHandler<
  ListOwnerPropertyInstallmentsQuery,
  PaginatedResult<InstallmentSummaryView>
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly properties: PropertiesFacade,
    private readonly billing: BillingFacade,
  ) {}

  async execute(
    query: ListOwnerPropertyInstallmentsQuery,
  ): Promise<PaginatedResult<InstallmentSummaryView>> {
    const ownerId = await this.identity.ownerId(query.userId)
    const property = await this.properties.find(query.propertyId)
    if (!property || property.ownerId !== ownerId) {
      throw new PortalEntityNotFoundException(
        'PROPERTY_NOT_FOUND',
        'La propiedad no existe',
        query.propertyId,
      )
    }
    return paginateWith(query.page, (page) =>
      this.billing.pageInstallmentsOfProperty(ownerId, property.id, page),
    )
  }
}
