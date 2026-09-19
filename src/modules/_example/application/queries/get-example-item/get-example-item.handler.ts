import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { ExampleItemNotFoundException } from '@/modules/_example/domain/example-item.exceptions'
import { ExampleItemRepository } from '@/modules/_example/domain/example-item.repository'
import { ExampleItemView, toExampleItemView } from '../../example-item.view'
import { GetExampleItemQuery } from './get-example-item.query'

/**
 * Caso de uso de lectura. Un id de otra inmobiliaria no se encuentra (filtro
 * de tenant) y termina en el mismo 404 que un id inexistente.
 */
@QueryHandler(GetExampleItemQuery)
export class GetExampleItemHandler implements IQueryHandler<
  GetExampleItemQuery,
  ExampleItemView
> {
  constructor(private readonly items: ExampleItemRepository) {}

  async execute(query: GetExampleItemQuery): Promise<ExampleItemView> {
    const item = await this.items.findById(query.id)
    if (!item) throw new ExampleItemNotFoundException(query.id)
    return toExampleItemView(item)
  }
}
