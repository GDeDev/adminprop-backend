import { DomainErrorKind, DomainException } from '@/shared/errors'

// ------------------------------------------------------------- Servicios

export class ServiceNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'SERVICE_NOT_FOUND',
      'El servicio no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

/** La propiedad no existe, es de otra inmobiliaria o fue borrada (D-44). */
export class ServicePropertyNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'SERVICE_PROPERTY_NOT_FOUND',
      'La propiedad no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class ServiceContractNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'SERVICE_CONTRACT_NOT_FOUND',
      'El contrato no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class InvalidServicePropertyException extends DomainException {
  constructor() {
    super(
      'SERVICE_INVALID_PROPERTY',
      'La propiedad no existe',
      DomainErrorKind.BusinessRule,
      { field: 'propertyId' },
    )
  }
}

/** El contrato no existe o no es de esta propiedad. */
export class InvalidServiceContractException extends DomainException {
  constructor() {
    super(
      'SERVICE_INVALID_CONTRACT',
      'El contrato no existe o no es de esta propiedad',
      DomainErrorKind.BusinessRule,
      { field: 'contractId' },
    )
  }
}

/** Como en propiedades: un tipo desactivado no se elige en altas nuevas. */
export class InvalidServiceTypeException extends DomainException {
  constructor() {
    super(
      'SERVICE_INVALID_SERVICE_TYPE',
      'El tipo de servicio no existe o está desactivado',
      DomainErrorKind.BusinessRule,
      { field: 'serviceTypeId' },
    )
  }
}

/** Spec 6: con vencimiento, la fecha es obligatoria. */
export class ServiceDueDateRequiredException extends DomainException {
  constructor() {
    super(
      'SERVICE_DUE_DATE_REQUIRED',
      'Si el servicio tiene vencimiento, cargá la fecha',
      DomainErrorKind.InvalidInput,
      { field: 'dueDate' },
    )
  }
}

export class ServiceIncreaseFrequencyRequiredException extends DomainException {
  constructor() {
    super(
      'SERVICE_INCREASE_FREQUENCY_REQUIRED',
      'Si el servicio tiene aumentos, indicá cada cuánto',
      DomainErrorKind.InvalidInput,
      { field: 'increaseFrequency' },
    )
  }
}

export class InvalidServiceDateException extends DomainException {
  constructor(field: string) {
    super(
      'SERVICE_INVALID_DATE',
      'La fecha no es una fecha válida (AAAA-MM-DD)',
      DomainErrorKind.InvalidInput,
      { field },
    )
  }
}
