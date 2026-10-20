import { DomainErrorKind, DomainException } from '@/shared/errors'

export class GuarantorNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'GUARANTOR_NOT_FOUND',
      'El garante no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class GuarantorNationalIdTakenException extends DomainException {
  constructor(existingGuarantorId: string) {
    super(
      'GUARANTOR_NATIONAL_ID_TAKEN',
      'Ya hay un garante cargado con ese DNI/CUIT',
      DomainErrorKind.Conflict,
      { existingGuarantorId },
    )
  }
}

export class InvalidGuarantorNationalIdException extends DomainException {
  constructor() {
    super(
      'GUARANTOR_INVALID_NATIONAL_ID',
      'El DNI/CUIT tiene que tener entre 7 y 11 dígitos',
      DomainErrorKind.InvalidInput,
    )
  }
}

/** Spec 4 y 6: el detalle de la garantía es texto libre, pero no vacío. */
export class GuarantorDetailRequiredException extends DomainException {
  constructor() {
    super(
      'GUARANTOR_DETAIL_REQUIRED',
      'Cargá el detalle de la garantía: la dirección del inmueble o el empleador y el sueldo',
      DomainErrorKind.InvalidInput,
    )
  }
}

/** Spec 3.2: con inquilinos a cargo no se borra (D-45). */
export class GuarantorInUseException extends DomainException {
  constructor(count: number) {
    super(
      'GUARANTOR_IN_USE',
      `No se puede eliminar: es garante de ${count} ${count === 1 ? 'inquilino' : 'inquilinos'}. Cambiales el garante primero.`,
      DomainErrorKind.Conflict,
      { count },
    )
  }
}
