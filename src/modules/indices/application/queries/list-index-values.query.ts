import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { IndexType } from '@/modules/indices/domain/index-value'
import { IndexValueRepository } from '@/modules/indices/domain/index-value.ports'
import { IndexValueView, toIndexValueView } from '../index-value.view'

export class ListIndexValuesQuery {
  constructor(public readonly indexType: IndexType) {}
}

/** Sin paginar: un índice tiene doce valores por año. */
@QueryHandler(ListIndexValuesQuery)
export class ListIndexValuesHandler implements IQueryHandler<
  ListIndexValuesQuery,
  IndexValueView[]
> {
  constructor(private readonly indices: IndexValueRepository) {}

  async execute(query: ListIndexValuesQuery): Promise<IndexValueView[]> {
    const values = await this.indices.listByType(query.indexType)
    return values.map(toIndexValueView)
  }
}
