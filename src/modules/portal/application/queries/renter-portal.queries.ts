import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import {
  BillingFacade,
  InstallmentDetailView,
  InstallmentSummaryView,
} from '@/modules/billing/public'
import { CollectionMode, ContractsFacade } from '@/modules/contracts/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { ServicesFacade } from '@/modules/services/public'
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
  maskInstallmentDetailForRenter,
  maskInstallmentSummaryForRenter,
  toRenterContract,
} from '../portal.mappers'
import {
  PortalRenterAccountView,
  PortalRenterContractView,
  PortalRenterMeView,
} from '../portal.views'

// Todas las queries llevan el id del usuario logueado y nada más: la persona
// se resuelve en el handler, nunca viene del request.

export class GetRenterMeQuery {
  constructor(public readonly userId: string) {}
}

export class GetRenterContractQuery {
  constructor(public readonly userId: string) {}
}

export class GetRenterAccountQuery {
  constructor(public readonly userId: string) {}
}

export class ListRenterInstallmentsQuery {
  constructor(
    public readonly userId: string,
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

export class GetRenterInstallmentQuery {
  constructor(
    public readonly userId: string,
    public readonly installmentId: string,
  ) {}
}

export class GetRenterReceiptUrlQuery {
  constructor(
    public readonly userId: string,
    public readonly paymentId: string,
  ) {}
}

@QueryHandler(GetRenterMeQuery)
export class GetRenterMeHandler implements IQueryHandler<
  GetRenterMeQuery,
  PortalRenterMeView
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly renters: RentersFacade,
  ) {}

  async execute(query: GetRenterMeQuery): Promise<PortalRenterMeView> {
    const renterId = await this.identity.renterId(query.userId)
    const [profile, agency] = await Promise.all([
      this.renters.portalProfile(renterId),
      this.identity.agency(),
    ])
    if (!profile) throw new PortalProfileNotFoundException('RENTER')
    return {
      id: profile.id,
      fullName: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      agency,
    }
  }
}

/** El contrato activo o, si no tiene, el último (A-35). Null si nunca tuvo uno. */
@QueryHandler(GetRenterContractQuery)
export class GetRenterContractHandler implements IQueryHandler<
  GetRenterContractQuery,
  PortalRenterContractView | null
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly contracts: ContractsFacade,
    private readonly services: ServicesFacade,
    private readonly properties: PropertiesFacade,
  ) {}

  async execute(
    query: GetRenterContractQuery,
  ): Promise<PortalRenterContractView | null> {
    const renterId = await this.identity.renterId(query.userId)
    const contract = await this.contracts.portalContractOfRenter(renterId)
    if (!contract) return null
    const propertyId = contract.property?.id
    const [services, types] = await Promise.all([
      propertyId
        ? this.services.listForContract(propertyId, contract.id)
        : Promise.resolve([]),
      propertyId
        ? this.properties.typeNames([propertyId])
        : Promise.resolve(new Map<string, string>()),
    ])
    return toRenterContract(
      contract,
      services,
      (propertyId && types.get(propertyId)) || null,
    )
  }
}

/**
 * Estado de cuenta: la cuota del mes del contrato (o la última si ya no hay
 * contrato activo), el saldo a favor, la mora y cómo pagar.
 */
@QueryHandler(GetRenterAccountQuery)
export class GetRenterAccountHandler implements IQueryHandler<
  GetRenterAccountQuery,
  PortalRenterAccountView
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly contracts: ContractsFacade,
    private readonly billing: BillingFacade,
  ) {}

  async execute(
    query: GetRenterAccountQuery,
  ): Promise<PortalRenterAccountView> {
    const renterId = await this.identity.renterId(query.userId)
    const [contract, agency, credits, [arrears]] = await Promise.all([
      this.contracts.portalContractOfRenter(renterId),
      this.identity.agency(),
      this.billing.creditsAvailableOfRenter(renterId),
      this.billing.arrearsByRenter([renterId]),
    ])
    const installment = contract
      ? await this.billing.currentInstallmentOfRenter(
          renterId,
          contract.id,
          periodOf(todayIso()),
        )
      : null
    const kind = contract?.billingTerms.collectionMode ?? CollectionMode.AGENCY
    return {
      contract: contract ? { id: contract.id, status: contract.status } : null,
      currentInstallment: installment
        ? maskInstallmentDetailForRenter(installment)
        : null,
      creditsAvailable: credits,
      arrears,
      // Si cobra el propietario, el inquilino no ve los datos de la inmobiliaria para pagar.
      paymentInstructions: {
        kind,
        bankAccount: kind === CollectionMode.AGENCY ? agency.bankAccount : null,
      },
    }
  }
}

@QueryHandler(ListRenterInstallmentsQuery)
export class ListRenterInstallmentsHandler implements IQueryHandler<
  ListRenterInstallmentsQuery,
  PaginatedResult<InstallmentSummaryView>
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly billing: BillingFacade,
  ) {}

  async execute(
    query: ListRenterInstallmentsQuery,
  ): Promise<PaginatedResult<InstallmentSummaryView>> {
    const renterId = await this.identity.renterId(query.userId)
    return paginateWith(query.page, async (page) => {
      const [rows, total] = await this.billing.pageInstallmentsOfRenter(
        renterId,
        page,
      )
      return [rows.map(maskInstallmentSummaryForRenter), total]
    })
  }
}

@QueryHandler(GetRenterInstallmentQuery)
export class GetRenterInstallmentHandler implements IQueryHandler<
  GetRenterInstallmentQuery,
  InstallmentDetailView
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly billing: BillingFacade,
  ) {}

  async execute(
    query: GetRenterInstallmentQuery,
  ): Promise<InstallmentDetailView> {
    const renterId = await this.identity.renterId(query.userId)
    const installment = await this.billing.installmentOfRenter(
      renterId,
      query.installmentId,
    )
    if (!installment) {
      throw new PortalEntityNotFoundException(
        'INSTALLMENT_NOT_FOUND',
        'La cuota no existe',
        query.installmentId,
      )
    }
    return maskInstallmentDetailForRenter(installment)
  }
}

/** La URL del recibo PDF de un pago suyo (Fase 15). */
@QueryHandler(GetRenterReceiptUrlQuery)
export class GetRenterReceiptUrlHandler implements IQueryHandler<
  GetRenterReceiptUrlQuery,
  string
> {
  constructor(
    private readonly identity: PortalIdentity,
    private readonly billing: BillingFacade,
  ) {}

  async execute(query: GetRenterReceiptUrlQuery): Promise<string> {
    const renterId = await this.identity.renterId(query.userId)
    const receipt = await this.billing.receiptOfRenter(
      renterId,
      query.paymentId,
    )
    if (!receipt) {
      throw new PortalEntityNotFoundException(
        'PAYMENT_NOT_FOUND',
        'El pago no existe',
        query.paymentId,
      )
    }
    if (!receipt.url) throw new PortalDocumentNotReadyException(query.paymentId)
    return receipt.url
  }
}
