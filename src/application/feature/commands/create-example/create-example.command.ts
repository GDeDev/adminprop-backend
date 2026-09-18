import { ICommand } from '@nestjs/cqrs'

type CreateExampleCommandData = {
  name: string
}

export class CreateExampleCommand implements ICommand {
  constructor(public readonly data: CreateExampleCommandData) {}
}
