import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { Location } from '@/modules/master-data/domain/location'
import {
  InvalidLocationParentException,
  LocationNameTakenException,
  LocationNotFoundException,
} from '@/modules/master-data/domain/master-data.exceptions'
import { MasterDataPolicy } from '@/modules/master-data/domain/master-data.policy'
import { LocationRepository } from '@/modules/master-data/domain/master-data.repositories'
import {
  CreateLocationCommand,
  RenameLocationCommand,
  SetLocationActiveCommand,
} from './location.commands'

@CommandHandler(CreateLocationCommand)
export class CreateLocationHandler implements ICommandHandler<
  CreateLocationCommand,
  Location
> {
  constructor(private readonly locations: LocationRepository) {}

  async execute(command: CreateLocationCommand): Promise<Location> {
    // Un padre de otra inmobiliaria no se encuentra (filtro de tenant): para
    // esta regla es igual que uno que no existe.
    const parent = command.parentId
      ? await this.locations.findById(command.parentId)
      : null
    if (command.parentId && !parent) {
      throw new InvalidLocationParentException('La ubicación padre no existe')
    }
    MasterDataPolicy.assertValidParent(command.level, parent)

    const name = MasterDataPolicy.normalizeName(command.name)
    if (await this.locations.existsByName(command.parentId, name)) {
      throw new LocationNameTakenException(name)
    }

    return this.locations.create({
      level: command.level,
      name,
      parentId: command.parentId,
    })
  }
}

/**
 * Sólo cambia el nombre. Mover una ubicación de padre arrastraría todo lo que
 * cuelga de ella y lo que la usa: si hace falta, es un caso aparte.
 */
@CommandHandler(RenameLocationCommand)
export class RenameLocationHandler implements ICommandHandler<
  RenameLocationCommand,
  Location
> {
  constructor(private readonly locations: LocationRepository) {}

  async execute(command: RenameLocationCommand): Promise<Location> {
    const current = await this.locations.findById(command.id)
    if (!current) throw new LocationNotFoundException(command.id)

    const name = MasterDataPolicy.normalizeName(command.name)
    if (await this.locations.existsByName(current.parentId, name, current.id)) {
      throw new LocationNameTakenException(name)
    }
    return this.locations.rename(current.id, name)
  }
}

/**
 * Desactivar o reactivar. Reactivar una ubicación con el padre desactivado se
 * permite (spec, casos borde): avisarlo es cosa del frontend.
 */
@CommandHandler(SetLocationActiveCommand)
export class SetLocationActiveHandler implements ICommandHandler<
  SetLocationActiveCommand,
  Location
> {
  constructor(private readonly locations: LocationRepository) {}

  async execute(command: SetLocationActiveCommand): Promise<Location> {
    if (!(await this.locations.findById(command.id))) {
      throw new LocationNotFoundException(command.id)
    }
    return this.locations.setActive(command.id, command.isActive)
  }
}
