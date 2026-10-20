import { DomainErrorKind, DomainException } from '@/shared/errors'

export class OwnerNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'OWNER_NOT_FOUND',
      'El propietario no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

/** Spec 4: el DNI es único por inmobiliaria (no globalmente). */
export class OwnerNationalIdTakenException extends DomainException {
  constructor(existingOwnerId: string) {
    super(
      'OWNER_NATIONAL_ID_TAKEN',
      'Ya hay un propietario cargado con ese DNI/CUIT',
      DomainErrorKind.Conflict,
      { existingOwnerId },
    )
  }
}

export class InvalidNationalIdException extends DomainException {
  constructor() {
    super(
      'OWNER_INVALID_NATIONAL_ID',
      'El DNI/CUIT tiene que tener entre 7 y 11 dígitos',
      DomainErrorKind.InvalidInput,
    )
  }
}

/** Spec 7: CBU inválido es un 400. Además del largo, se validan los verificadores. */
export class InvalidCbuException extends DomainException {
  constructor() {
    super(
      'OWNER_INVALID_CBU',
      'El CBU no es válido: revisá los 22 dígitos',
      DomainErrorKind.InvalidInput,
    )
  }
}

/** Spec 7: sin email no hay a dónde mandar el acceso. */
export class OwnerEmailRequiredException extends DomainException {
  constructor() {
    super(
      'OWNER_EMAIL_REQUIRED',
      'Cargá el email del propietario antes de generarle el acceso al portal',
      DomainErrorKind.BusinessRule,
    )
  }
}

/** Spec 3.7: con propiedades a cargo no se borra. */
export class OwnerHasPropertiesException extends DomainException {
  constructor(count: number) {
    super(
      'OWNER_HAS_PROPERTIES',
      `No se puede eliminar: tiene ${count} ${count === 1 ? 'propiedad asignada' : 'propiedades asignadas'}. Reasignalas primero.`,
      DomainErrorKind.Conflict,
      { count },
    )
  }
}
