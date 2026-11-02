import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { ContractsFacade } from '@/modules/contracts/public'
import { todayIso } from '@/shared/dates/calendar-date'
import { InventoryStatus, InventoryType } from '../domain/inventory'
import {
  compareInventories,
  InventoryComparison,
} from '../domain/inventory-comparison'
import { InventoryContractNotFoundException } from '../domain/inventory.exceptions'
import { InventoryPolicy } from '../domain/inventory.policy'
import { InventoryRepository } from '../domain/inventory.ports'
import { requireInventory } from './inventory.handlers'
import {
  ContractInventoriesView,
  InventoryDetailView,
  InventoryViews,
} from './inventory.views'

export class ListContractInventoriesQuery {
  constructor(public readonly contractId: string) {}
}

export class GetInventoryQuery {
  constructor(public readonly id: string) {}
}

export class CompareInventoriesQuery {
  constructor(public readonly contractId: string) {}
}

/** Los vigentes del contrato y si se puede crear cada tipo (A-42, A-44). */
@QueryHandler(ListContractInventoriesQuery)
export class ListContractInventoriesHandler implements IQueryHandler<
  ListContractInventoriesQuery,
  ContractInventoriesView
> {
  constructor(
    private readonly inventories: InventoryRepository,
    private readonly contracts: ContractsFacade,
    private readonly views: InventoryViews,
  ) {}

  async execute(
    query: ListContractInventoriesQuery,
  ): Promise<ContractInventoriesView> {
    const contract = await this.contracts.find(query.contractId)
    if (!contract)
      throw new InventoryContractNotFoundException(query.contractId)

    const current = await this.inventories.listCurrentByContract(contract.id)
    const has = (type: InventoryType) => current.some((i) => i.type === type)
    return {
      inventories: await this.views.summaries(current),
      canCreateDelivery: !has(InventoryType.DELIVERY),
      canCreateReturn:
        !has(InventoryType.RETURN) &&
        InventoryPolicy.canCreateReturn(contract, todayIso()),
    }
  }
}

@QueryHandler(GetInventoryQuery)
export class GetInventoryHandler implements IQueryHandler<
  GetInventoryQuery,
  InventoryDetailView
> {
  constructor(
    private readonly inventories: InventoryRepository,
    private readonly views: InventoryViews,
  ) {}

  async execute(query: GetInventoryQuery): Promise<InventoryDetailView> {
    return this.views.detail(await requireInventory(this.inventories, query.id))
  }
}

/**
 * Entrega contra devolución, con los vigentes y confirmados de cada tipo: un
 * borrador no es un acta y no entra en la comparación.
 */
@QueryHandler(CompareInventoriesQuery)
export class CompareInventoriesHandler implements IQueryHandler<
  CompareInventoriesQuery,
  InventoryComparison
> {
  constructor(
    private readonly inventories: InventoryRepository,
    private readonly contracts: ContractsFacade,
  ) {}

  async execute(query: CompareInventoriesQuery): Promise<InventoryComparison> {
    if (!(await this.contracts.exists(query.contractId))) {
      throw new InventoryContractNotFoundException(query.contractId)
    }
    const current = await this.inventories.listCurrentByContract(
      query.contractId,
    )
    const confirmed = (type: InventoryType) =>
      current.find(
        (i) => i.type === type && i.status === InventoryStatus.CONFIRMED,
      ) ?? null
    return compareInventories(
      confirmed(InventoryType.DELIVERY),
      confirmed(InventoryType.RETURN),
    )
  }
}
