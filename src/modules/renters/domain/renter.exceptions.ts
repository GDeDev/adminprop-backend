import { DomainErrorKind, DomainException } from '@/shared/errors'

export class RenterNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'RENTER_NOT_FOUND',
      'El inquilino no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

/** Spec 4: el DNI es único por inmobiliaria, mismo criterio que propietarios. */
export class RenterNationalIdTakenException extends DomainException {
  constructor(existingRenterId: string) {
    super(
      'RENTER_NATIONAL_ID_TAKEN',
      'Ya hay un inquilino cargado con ese DNI/CUIT',
      DomainErrorKind.Conflict,
      { existingRenterId },
    )
  }
}

export class InvalidRenterNationalIdException extends DomainException {
  constructor() {
    super(
      'RENTER_INVALID_NATIONAL_ID',
      'El DNI/CUIT tiene que tener entre 7 y 11 dígitos',
      DomainErrorKind.InvalidInput,
    )
  }
}

export class InvalidMoveInDateException extends DomainException {
  constructor() {
    super(
      'RENTER_INVALID_MOVE_IN_DATE',
      'La fecha de ingreso no es una fecha válida (AAAA-MM-DD)',
      DomainErrorKind.InvalidInput,
    )
  }
}

/**
 * El garante elegido no existe, es de otra inmobiliaria o fue borrado. Misma
 * regla (y mismo 422) que una propiedad con propietario inexistente (D-44).
 */
export class InvalidGuarantorReferenceException extends DomainException {
  constructor() {
    super(
      'RENTER_INVALID_GUARANTOR',
      'El garante no existe',
      DomainErrorKind.BusinessRule,
      { field: 'guarantorId' },
    )
  }
}

/** Sin email no hay a dónde mandar el acceso (como en propietarios). */
export class RenterEmailRequiredException extends DomainException {
  constructor() {
    super(
      'RENTER_EMAIL_REQUIRED',
      'Cargá el email del inquilino antes de generarle el acceso al portal',
      DomainErrorKind.BusinessRule,
    )
  }
}

/** Spec 3.1: con contrato activo no se borra. */
export class RenterHasActiveContractException extends DomainException {
  constructor() {
    super(
      'RENTER_HAS_ACTIVE_CONTRACT',
      'No se puede eliminar: el inquilino tiene un contrato activo',
      DomainErrorKind.Conflict,
    )
  }
}
