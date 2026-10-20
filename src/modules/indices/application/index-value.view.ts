import { IndexType, IndexValue } from '../domain/index-value'

export interface IndexValueView {
  id: string
  indexType: IndexType
  /** `AAAA-MM`. */
  period: string
  /** Decimal como string. */
  value: string
  source: string
  createdAt: Date
}

export function toIndexValueView(value: IndexValue): IndexValueView {
  return {
    id: value.id,
    indexType: value.indexType,
    period: value.period,
    value: value.value,
    source: value.source,
    createdAt: value.createdAt,
  }
}
