import { EventBus } from '@nestjs/cqrs'

import { ExampleItemCreatedEvent } from '@/modules/_example/application/events/example-item-created.event'
import { ExampleItem } from '@/modules/_example/domain/example-item.entity'
import {
  ExampleItemInvalidPriceException,
  ExampleItemNameTakenException,
} from '@/modules/_example/domain/example-item.exceptions'
import { ExampleItemRepository } from '@/modules/_example/domain/example-item.repository'
import { CreateExampleItemCommand } from './create-example-item.command'
import { CreateExampleItemHandler } from './create-example-item.handler'

const ITEM: ExampleItem = {
  id: 'item-1',
  tenantId: 'tenant-a',
  name: 'Casa',
  price: '1500.50',
  attachmentKey: null,
  attachmentUrl: null,
  createdAt: new Date('2026-09-19'),
}

/**
 * Test unitario de un handler: el repositorio y el EventBus son mocks, las
 * reglas (ExampleItemPolicy) son las reales.
 */
describe('CreateExampleItemHandler', () => {
  let items: jest.Mocked<ExampleItemRepository>
  let eventBus: jest.Mocked<Pick<EventBus, 'publish'>>
  let handler: CreateExampleItemHandler

  beforeEach(() => {
    items = {
      create: jest.fn().mockResolvedValue(ITEM),
      existsByName: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<ExampleItemRepository>
    eventBus = { publish: jest.fn() }
    handler = new CreateExampleItemHandler(
      items,
      eventBus as unknown as EventBus,
    )
  })

  it('normaliza el nombre y el precio antes de guardar', async () => {
    await handler.execute(new CreateExampleItemCommand('  Casa ', '1500.5'))

    expect(items.create).toHaveBeenCalledWith({
      name: 'Casa',
      price: '1500.50',
    })
  })

  it('emite ExampleItemCreatedEvent con los datos guardados', async () => {
    await handler.execute(new CreateExampleItemCommand('Casa', '1500.50'))

    expect(eventBus.publish).toHaveBeenCalledWith(
      new ExampleItemCreatedEvent('item-1', 'Casa', '1500.50'),
    )
  })

  it('no devuelve campos internos como la key del adjunto', async () => {
    const view = await handler.execute(
      new CreateExampleItemCommand('Casa', '1500.50'),
    )

    expect(view).not.toHaveProperty('attachmentKey')
    expect(view).not.toHaveProperty('tenantId')
  })

  it('rechaza un nombre repetido en el tenant sin guardar ni emitir nada', async () => {
    items.existsByName.mockResolvedValue(true)

    await expect(
      handler.execute(new CreateExampleItemCommand('Casa', '10')),
    ).rejects.toBeInstanceOf(ExampleItemNameTakenException)
    expect(items.create).not.toHaveBeenCalled()
    expect(eventBus.publish).not.toHaveBeenCalled()
  })

  it('rechaza un precio no positivo', async () => {
    await expect(
      handler.execute(new CreateExampleItemCommand('Casa', '0')),
    ).rejects.toBeInstanceOf(ExampleItemInvalidPriceException)
  })
})
