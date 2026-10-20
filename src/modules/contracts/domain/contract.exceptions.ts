import { DomainErrorKind, DomainException } from '@/shared/errors'

import { ContractStatus } from './contract'

const STATUS_LABELS: Record<ContractStatus, string> = {
  [ContractStatus.ACTIVE]: 'activo',
  [ContractStatus.FINISHED]: 'finalizado',
  [ContractStatus.TERMINATED]: 'rescindido',
}

export class ContractNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'CONTRACT_NOT_FOUND',
      'El contrato no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

/** RN-04: una propiedad tiene un solo contrato activo. */
export class PropertyAlreadyRentedException extends DomainException {
  constructor(activeContractId: string) {
    super(
      'CONTRACT_PROPERTY_ALREADY_RENTED',
      'La propiedad ya tiene un contrato activo',
      DomainErrorKind.Conflict,
      { activeContractId },
    )
  }
}

/** RN-05: un inquilino es titular de un solo contrato activo. */
export class RenterAlreadyActiveException extends DomainException {
  constructor(activeContractId: string) {
    super(
      'CONTRACT_RENTER_ALREADY_ACTIVE',
      'El inquilino ya es titular de otro contrato activo',
      DomainErrorKind.Conflict,
      { activeContractId },
    )
  }
}

/** La propiedad no existe, es de otra inmobiliaria o fue borrada (D-44). */
export class InvalidPropertyReferenceException extends DomainException {
  constructor() {
    super(
      'CONTRACT_INVALID_PROPERTY',
      'La propiedad no existe',
      DomainErrorKind.BusinessRule,
      { field: 'propertyId' },
    )
  }
}

/** El propietario del contrato sale de la propiedad: sin él no hay contrato. */
export class PropertyWithoutOwnerException extends DomainException {
  constructor() {
    super(
      'CONTRACT_PROPERTY_WITHOUT_OWNER',
      'La propiedad no tiene propietario asignado: cargalo antes de armar el contrato',
      DomainErrorKind.BusinessRule,
      { field: 'propertyId' },
    )
  }
}

export class InvalidRenterReferenceException extends DomainException {
  constructor() {
    super(
      'CONTRACT_INVALID_RENTER',
      'El inquilino no existe',
      DomainErrorKind.BusinessRule,
      { field: 'renterId' },
    )
  }
}

export class InvalidGuarantorReferenceException extends DomainException {
  constructor() {
    super(
      'CONTRACT_INVALID_GUARANTOR',
      'El garante no existe',
      DomainErrorKind.BusinessRule,
      { field: 'guarantorId' },
    )
  }
}

export class InvalidContractDateException extends DomainException {
  constructor(field: string) {
    super(
      'CONTRACT_INVALID_DATE',
      'La fecha no es una fecha válida (AAAA-MM-DD)',
      DomainErrorKind.InvalidInput,
      { field },
    )
  }
}

/** Spec 3.1: la fecha de fin es posterior a la de inicio. */
export class ContractDatesInvalidException extends DomainException {
  constructor() {
    super(
      'CONTRACT_DATES_INVALID',
      'La fecha de fin tiene que ser posterior a la de inicio',
      DomainErrorKind.InvalidInput,
      { field: 'endDate' },
    )
  }
}

/** Spec 3.1: con caución, el email de la aseguradora es obligatorio (RN-10). */
export class SuretyEmailRequiredException extends DomainException {
  constructor() {
    super(
      'CONTRACT_SURETY_EMAIL_REQUIRED',
      'Con seguro de caución hay que cargar el email de alerta de la aseguradora',
      DomainErrorKind.InvalidInput,
      { field: 'insurerAlertEmail' },
    )
  }
}

export class InvalidContractDocumentException extends DomainException {
  constructor(reason: string) {
    super(
      'CONTRACT_INVALID_DOCUMENT',
      `El archivo no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
    )
  }
}

/** Rescindir, renovar o actualizar sólo tienen sentido sobre un contrato activo. */
export class ContractNotActiveException extends DomainException {
  constructor(status: ContractStatus) {
    super(
      'CONTRACT_NOT_ACTIVE',
      `El contrato está ${STATUS_LABELS[status]}: sólo un contrato activo se puede modificar`,
      DomainErrorKind.Conflict,
      { status },
    )
  }
}

export class RentUpdateNotDueException extends DomainException {
  constructor(nextUpdateOn: string | null) {
    super(
      'CONTRACT_RENT_UPDATE_NOT_DUE',
      nextUpdateOn
        ? `El próximo aumento corresponde el ${nextUpdateOn}: todavía no se puede aplicar`
        : 'No quedan aumentos por aplicar: el contrato termina antes del próximo',
      DomainErrorKind.Conflict,
      { nextUpdateOn },
    )
  }
}

/** Spec 3.8: sin el índice del período, 422 con mensaje claro. */
export class IndexMissingException extends DomainException {
  constructor(indexType: string, period: string) {
    super(
      'CONTRACT_INDEX_MISSING',
      `Falta el valor del ${indexType} de ${period}: cargalo en Índices y volvé a aplicar el aumento`,
      DomainErrorKind.BusinessRule,
      { indexType, period },
    )
  }
}

/** Un contrato "Fijo" u "Otro" no tiene índice: el nuevo monto viene a mano. */
export class NewRentRequiredException extends DomainException {
  constructor() {
    super(
      'CONTRACT_NEW_RENT_REQUIRED',
      'Para este contrato el aumento se carga a mano: indicá el nuevo alquiler, mayor que cero',
      DomainErrorKind.InvalidInput,
      { field: 'newRent' },
    )
  }
}

/** Spec 7: no tiene sentido rescindir un contrato ya vencido. */
export class TerminationDateInvalidException extends DomainException {
  constructor() {
    super(
      'CONTRACT_TERMINATION_DATE_INVALID',
      'La fecha de notificación tiene que estar entre el inicio del contrato y el día anterior a su fin',
      DomainErrorKind.InvalidInput,
      { field: 'notifiedAt' },
    )
  }
}

export class RenewalStartInvalidException extends DomainException {
  constructor() {
    super(
      'CONTRACT_RENEWAL_START_INVALID',
      'La renovación no puede empezar antes que el contrato original',
      DomainErrorKind.InvalidInput,
      { field: 'startDate' },
    )
  }
}
