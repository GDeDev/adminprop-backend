import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import {
  ActiveFilter,
  Catalog,
  CatalogItem,
} from '@/modules/master-data/domain/catalog'
import { CatalogItemNotFoundException } from '@/modules/master-data/domain/master-data.exceptions'
import { CatalogRepository } from '@/modules/master-data/domain/master-data.repositories'

export class ListCatalogItemsQuery {
  constructor(
    public readonly catalog: Catalog,
    public readonly active: ActiveFilter,
  ) {}
}

export class GetCatalogItemQuery {
  constructor(
    public readonly catalog: Catalog,
    public readonly id: string,
  ) {}
}

@QueryHandler(ListCatalogItemsQuery)
export class ListCatalogItemsHandler implements IQueryHandler<
  ListCatalogItemsQuery,
  CatalogItem[]
> {
  constructor(private readonly items: CatalogRepository) {}

  execute(query: ListCatalogItemsQuery): Promise<CatalogItem[]> {
    return this.items.list(query.catalog, query.active)
  }
}

@QueryHandler(GetCatalogItemQuery)
export class GetCatalogItemHandler implements IQueryHandler<
  GetCatalogItemQuery,
  CatalogItem
> {
  constructor(private readonly items: CatalogRepository) {}

  async execute(query: GetCatalogItemQuery): Promise<CatalogItem> {
    const item = await this.items.findById(query.catalog, query.id)
    if (!item) throw new CatalogItemNotFoundException(query.catalog, query.id)
    return item
  }
}
