import { IndexType, IndexValue } from './index-value'

export interface IndexValueData {
  indexType: IndexType
  period: string
  value: string
  source: string
}

/** Puerto del repositorio. Sin tenant: los índices son globales. */
export abstract class IndexValueRepository {
  abstract create(data: IndexValueData): Promise<IndexValue>

  abstract find(
    indexType: IndexType,
    period: string,
  ): Promise<IndexValue | null>

  /** Todos los valores de un índice, del más reciente al más viejo. */
  abstract listByType(indexType: IndexType): Promise<IndexValue[]>
}
