import { LocationLevel } from '@/modules/master-data/domain/location'

export class CreateLocationCommand {
  constructor(
    public readonly level: LocationLevel,
    public readonly name: string,
    public readonly parentId: string | null,
  ) {}
}

export class RenameLocationCommand {
  constructor(
    public readonly id: string,
    public readonly name: string,
  ) {}
}

export class SetLocationActiveCommand {
  constructor(
    public readonly id: string,
    public readonly isActive: boolean,
  ) {}
}
