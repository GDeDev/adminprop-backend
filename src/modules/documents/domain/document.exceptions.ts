import { DomainErrorKind, DomainException } from '@/shared/errors'

/** Nunca se pidió ese documento, o la entidad no es del usuario (mismo 404). */
export class DocumentNotFoundException extends DomainException {
  constructor() {
    super(
      'DOCUMENT_NOT_FOUND',
      'El documento no existe o todavía no se pidió',
      DomainErrorKind.NotFound,
    )
  }
}

/** La entidad de origen (liquidación, pago, contrato) no existe. */
export class DocumentSourceNotFoundException extends DomainException {
  constructor(kind: string) {
    super(
      'DOCUMENT_SOURCE_NOT_FOUND',
      `No existe la entidad de origen del documento (${kind})`,
      DomainErrorKind.NotFound,
    )
  }
}

/** El documento no se puede armar para esa entidad (recibo sin número, contrato no rescindido). */
export class DocumentNotApplicableException extends DomainException {
  constructor(reason: string) {
    super(
      'DOCUMENT_NOT_APPLICABLE',
      `No se puede generar el documento: ${reason}`,
      DomainErrorKind.BusinessRule,
    )
  }
}
