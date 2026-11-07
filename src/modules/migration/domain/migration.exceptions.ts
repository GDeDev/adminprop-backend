import { DomainErrorKind, DomainException } from '@/shared/errors'

export class ImportBatchNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'IMPORT_BATCH_NOT_FOUND',
      'El lote de migración no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class ImportRowNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'IMPORT_ROW_NOT_FOUND',
      'La fila del lote no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

/** La API real de Tokko sólo la usa la inmobiliaria dueña de la key (D-253). */
export class TokkoNotEnabledException extends DomainException {
  constructor() {
    super(
      'TOKKO_NOT_ENABLED',
      'La importación desde Tokko no está habilitada para esta inmobiliaria',
      DomainErrorKind.Forbidden,
    )
  }
}

/** El archivo subido no es un .xlsx legible, o no tiene nada que importar. */
export class InvalidXlsxException extends DomainException {
  constructor(reason: string) {
    super('INVALID_XLSX', reason, DomainErrorKind.BusinessRule)
  }
}

export class TemplateVersionMismatchException extends DomainException {
  constructor(found: string | null, expected: string) {
    super(
      'TEMPLATE_VERSION_MISMATCH',
      'El archivo se armó con otra versión de la plantilla: descargá la plantilla actual y volcá ahí los datos',
      DomainErrorKind.BusinessRule,
      { found, expected },
    )
  }
}

export class TooManyRowsException extends DomainException {
  constructor(limit: number) {
    super(
      'IMPORT_TOO_MANY_ROWS',
      `El archivo tiene demasiadas filas: el máximo es ${limit} por archivo`,
      DomainErrorKind.BusinessRule,
      { limit },
    )
  }
}

/** Confirmar, editar o descartar un lote que ya no está pendiente de revisión. */
export class BatchNotReadyException extends DomainException {
  constructor(status: string) {
    super(
      'BATCH_NOT_READY',
      status === 'ANALYZING'
        ? 'El análisis todavía no terminó: esperá a que el lote esté listo para revisar'
        : 'El lote no está pendiente de revisión',
      DomainErrorKind.Conflict,
      { status },
    )
  }
}

export class BatchAlreadyConfirmedException extends DomainException {
  constructor() {
    super(
      'BATCH_ALREADY_CONFIRMED',
      'El lote ya se confirmó: no se puede importar dos veces',
      DomainErrorKind.Conflict,
    )
  }
}

/** Reintentar fotos de un lote que todavía no importó nada. */
export class BatchNotImportedException extends DomainException {
  constructor() {
    super(
      'BATCH_NOT_IMPORTED',
      'El lote todavía no se importó: no hay fotos para reintentar',
      DomainErrorKind.Conflict,
    )
  }
}

export class InvalidResolutionException extends DomainException {
  constructor(reason: string) {
    super('INVALID_RESOLUTION', reason, DomainErrorKind.BusinessRule)
  }
}

/** Una fila depende de otra que no se importó (omitida, fallida o excluida). */
export class DependencyNotImportedException extends DomainException {
  constructor(what: string) {
    super(
      'DEPENDENCY_NOT_IMPORTED',
      `No se importó ${what} del que depende esta fila`,
      DomainErrorKind.BusinessRule,
    )
  }
}

/** Reintentar fotos mientras todavía se están migrando. */
export class AssetsInProgressException extends DomainException {
  constructor() {
    super(
      'ASSETS_IN_PROGRESS',
      'Las fotos todavía se están migrando: esperá a que termine',
      DomainErrorKind.Conflict,
    )
  }
}
