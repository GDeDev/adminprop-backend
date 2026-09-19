import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { CatalogItem } from '@/modules/master-data/domain/catalog'
import {
  CatalogItemNameTakenException,
  CatalogItemNotFoundException,
} from '@/modules/master-data/domain/master-data.exceptions'
import { MasterDataPolicy } from '@/modules/master-data/domain/master-data.policy'
import { CatalogRepository } from '@/modules/master-data/domain/master-data.repositories'
import {
  CreateCatalogItemCommand,
  SetCatalogItemActiveCommand,
  UpdateCatalogItemCommand,
} from './catalog.commands'

/**
 * Casos de uso de los maestros planos. Uno solo por acción para los cuatro:
 * el `catalog` del command dice sobre cuál.
 */

@CommandHandler(CreateCatalogItemCommand)
export class CreateCatalogItemHandler implements ICommandHandler<
  CreateCatalogItemCommand,
  CatalogItem
> {
  constructor(private readonly items: CatalogRepository) {}

  async execute(command: CreateCatalogItemCommand): Promise<CatalogItem> {
    const name = MasterDataPolicy.normalizeName(command.name)
    if (await this.items.existsByName(command.catalog, name)) {
      throw new CatalogItemNameTakenException(command.catalog, name)
    }
    return this.items.create(command.catalog, { name, icon: command.icon })
  }
}

@CommandHandler(UpdateCatalogItemCommand)
export class UpdateCatalogItemHandler implements ICommandHandler<
  UpdateCatalogItemCommand,
  CatalogItem
> {
  constructor(private readonly items: CatalogRepository) {}

  async execute(command: UpdateCatalogItemCommand): Promise<CatalogItem> {
    const { catalog, id } = command
    if (!(await this.items.findById(catalog, id))) {
      throw new CatalogItemNotFoundException(catalog, id)
    }

    const name =
      command.changes.name === undefined
        ? undefined
        : MasterDataPolicy.normalizeName(command.changes.name)

    if (
      name !== undefined &&
      (await this.items.existsByName(catalog, name, id))
    ) {
      throw new CatalogItemNameTakenException(catalog, name)
    }

    return this.items.update(catalog, id, { name, icon: command.changes.icon })
  }
}

/**
 * Desactivar es el único "borrado" (spec 4): el ítem sale de los selectores
 * pero sigue valiendo para lo que ya lo usa. Es idempotente.
 */
@CommandHandler(SetCatalogItemActiveCommand)
export class SetCatalogItemActiveHandler implements ICommandHandler<
  SetCatalogItemActiveCommand,
  CatalogItem
> {
  constructor(private readonly items: CatalogRepository) {}

  async execute(command: SetCatalogItemActiveCommand): Promise<CatalogItem> {
    const { catalog, id } = command
    if (!(await this.items.findById(catalog, id))) {
      throw new CatalogItemNotFoundException(catalog, id)
    }
    return this.items.setActive(catalog, id, command.isActive)
  }
}
