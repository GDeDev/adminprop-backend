import { Catalog } from '@/modules/master-data/domain/catalog'

export class CreateCatalogItemCommand {
  constructor(
    public readonly catalog: Catalog,
    public readonly name: string,
    public readonly icon: string | null = null,
  ) {}
}

export class UpdateCatalogItemCommand {
  constructor(
    public readonly catalog: Catalog,
    public readonly id: string,
    public readonly changes: { name?: string; icon?: string | null },
  ) {}
}

export class SetCatalogItemActiveCommand {
  constructor(
    public readonly catalog: Catalog,
    public readonly id: string,
    public readonly isActive: boolean,
  ) {}
}
