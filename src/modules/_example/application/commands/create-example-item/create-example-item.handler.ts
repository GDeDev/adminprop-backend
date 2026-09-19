import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'

import { ExampleItemNameTakenException } from '@/modules/_example/domain/example-item.exceptions'
import { ExampleItemPolicy } from '@/modules/_example/domain/example-item.policy'
import { ExampleItemRepository } from '@/modules/_example/domain/example-item.repository'
import { toMoneyString } from '@/shared/money'
import { ExampleItemCreatedEvent } from '../../events/example-item-created.event'
import { ExampleItemView, toExampleItemView } from '../../example-item.view'
import { CreateExampleItemCommand } from './create-example-item.command'

/**
 * Caso de uso de escritura. El orden es el de cualquier handler del proyecto:
 * reglas del dominio → persistencia → evento.
 *
 * El handler orquesta; las reglas están en `ExampleItemPolicy`. El tenant no
 * aparece en ningún lado: lo pone el filtro de tenant de Prisma.
 */
@CommandHandler(CreateExampleItemCommand)
export class CreateExampleItemHandler implements ICommandHandler<
  CreateExampleItemCommand,
  ExampleItemView
> {
  constructor(
    private readonly items: ExampleItemRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: CreateExampleItemCommand): Promise<ExampleItemView> {
    const name = ExampleItemPolicy.normalizeName(command.name)
    const price = toMoneyString(command.price)
    ExampleItemPolicy.assertValidPrice(price)

    // Chequeo previo para un 409 con mensaje claro. La garantía real es el
    // índice único (tenant_id, name): una carrera termina en P2002 → 409.
    if (await this.items.existsByName(name)) {
      throw new ExampleItemNameTakenException(name)
    }

    const item = await this.items.create({ name, price })

    this.eventBus.publish(
      new ExampleItemCreatedEvent(item.id, item.name, item.price),
    )

    return toExampleItemView(item)
  }
}
