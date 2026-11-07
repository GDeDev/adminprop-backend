import { DomainErrorKind, DomainException } from '@/shared/errors'

import { IndexType } from './index-value'

export class IndexNotFoundException extends DomainException {
  constructor(indexType: IndexType, period: string) {
    super(
      'INDEX_NOT_FOUND',
      `No hay valor cargado del ${indexType} para ${period}`,
      DomainErrorKind.NotFound,
      { indexType, period },
    )
  }
}

/** Un índice tiene un solo valor por mes: el publicado. */
export class IndexPeriodTakenException extends DomainException {
  constructor(indexType: IndexType, period: string) {
    super(
      'INDEX_PERIOD_TAKEN',
      `El ${indexType} de ${period} ya está cargado`,
      DomainErrorKind.Conflict,
      { indexType, period },
    )
  }
}

export class InvalidIndexPeriodException extends DomainException {
  constructor() {
    super(
      'INDEX_INVALID_PERIOD',
      'El período tiene que ser AAAA-MM',
      DomainErrorKind.InvalidInput,
    )
  }
}

export class InvalidIndexValueException extends DomainException {
  constructor() {
    super(
      'INDEX_INVALID_VALUE',
      'El valor del índice tiene que ser mayor que cero',
      DomainErrorKind.InvalidInput,
    )
  }
}
