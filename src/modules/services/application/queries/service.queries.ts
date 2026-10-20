import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { ContractsFacade } from '@/modules/contracts/public'
import { PropertiesFacade } from '@/modules/properties/public'
import {
  ServiceContractNotFoundException,
  ServicePropertyNotFoundException,
} from '@/modules/services/domain/service.exceptions'
import { PropertyServiceRepository } from '@/modules/services/domain/service.ports'
import { todayIso } from '@/shared/dates/calendar-date'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { paginateWith } from '@/shared/pagination/pagination'
import {
  ContractServiceView,
  OverdueServiceView,
  PropertyServiceView,
  ServiceViews,
} from '../service.views'

export class ListPropertyServicesQuery {
  constructor(
    public readonly propertyId: string,
    public readonly contractId?: string,
  ) {}
}

export class ListContractServicesQuery {
  constructor(public readonly contractId: string) {}
}

export class ListOverdueServicesQuery {
  constructor(
    public readonly filter: { propertyId?: string },
    public readonly page: Partial<PaginationQueryDto>,
  ) {}
}

/** Spec 3.1: los servicios de una propiedad, con el estado calculado. */
@QueryHandler(ListPropertyServicesQuery)
export class ListPropertyServicesHandler implements IQueryHandler<
  ListPropertyServicesQuery,
  PropertyServiceView[]
> {
  constructor(
    private readonly services: PropertyServiceRepository,
    private readonly properties: PropertiesFacade,
    private readonly views: ServiceViews,
  ) {}

  async execute(
    query: ListPropertyServicesQuery,
  ): Promise<PropertyServiceView[]> {
    if (!(await this.properties.find(query.propertyId))) {
      throw new ServicePropertyNotFoundException(query.propertyId)
    }
    const services = await this.services.listByProperty(
      query.propertyId,
      query.contractId,
    )
    return this.views.many(services)
  }
}

/**
 * Los servicios que aplican a un contrato (D-66): los cargados para él más
 * los de la propiedad sin contrato, marcados con `scope`.
 */
@QueryHandler(ListContractServicesQuery)
export class ListContractServicesHandler implements IQueryHandler<
  ListContractServicesQuery,
  ContractServiceView[]
> {
  constructor(
    private readonly services: PropertyServiceRepository,
    private readonly contracts: ContractsFacade,
    private readonly views: ServiceViews,
  ) {}

  async execute(
    query: ListContractServicesQuery,
  ): Promise<ContractServiceView[]> {
    const contract = await this.contracts.find(query.contractId)
    if (!contract) throw new ServiceContractNotFoundException(query.contractId)
    const services = await this.services.listForContract(
      contract.propertyId,
      contract.id,
    )
    return this.views.forContract(services, contract.id)
  }
}

/** Spec 3.1: vencidos de toda la inmobiliaria para el dashboard, los más atrasados primero. */
@QueryHandler(ListOverdueServicesQuery)
export class ListOverdueServicesHandler implements IQueryHandler<
  ListOverdueServicesQuery,
  PaginatedResult<OverdueServiceView>
> {
  constructor(
    private readonly services: PropertyServiceRepository,
    private readonly views: ServiceViews,
  ) {}

  execute(
    query: ListOverdueServicesQuery,
  ): Promise<PaginatedResult<OverdueServiceView>> {
    const today = todayIso()
    return paginateWith(query.page, async (page) => {
      const [services, total] = await this.services.listOverdue(
        today,
        query.filter,
        page,
      )
      return [await this.views.overdue(services), total]
    })
  }
}
