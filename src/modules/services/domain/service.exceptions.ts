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

// ---------------------------------------------------- Gastos adelantados

export class ExpenseNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'EXPENSE_NOT_FOUND',
      'El gasto adelantado no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class ExpenseContractNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'EXPENSE_CONTRACT_NOT_FOUND',
      'El contrato no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

/** El contrato no existe o es de otra inmobiliaria. Cualquier estado sirve. */
export class InvalidExpenseContractException extends DomainException {
  constructor() {
    super(
      'EXPENSE_INVALID_CONTRACT',
      'El contrato no existe',
      DomainErrorKind.BusinessRule,
      { field: 'contractId' },
    )
  }
}

export class InvalidExpenseAmountException extends DomainException {
  constructor() {
    super(
      'EXPENSE_INVALID_AMOUNT',
      'El monto tiene que ser mayor que cero',
      DomainErrorKind.InvalidInput,
      { field: 'amount' },
    )
  }
}

export class InvalidExpenseDateException extends DomainException {
  constructor() {
    super(
      'EXPENSE_INVALID_DATE',
      'La fecha no es una fecha válida (AAAA-MM-DD)',
      DomainErrorKind.InvalidInput,
      { field: 'expenseDate' },
    )
  }
}

/** Spec 6: es plata que se le descuenta a un tercero; sin comprobante no hay gasto. */
export class ExpenseReceiptRequiredException extends DomainException {
  constructor() {
    super(
      'EXPENSE_RECEIPT_REQUIRED',
      'El comprobante es obligatorio: adjuntá la foto o el PDF',
      DomainErrorKind.InvalidInput,
      { field: 'file' },
    )
  }
}

export class InvalidExpenseReceiptException extends DomainException {
  constructor(reason: string) {
    super(
      'EXPENSE_INVALID_RECEIPT',
      `El comprobante no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field: 'file' },
    )
  }
}

/** Spec 4: descontado en una liquidación, el gasto es un registro contable cerrado. */
export class ExpenseAlreadySettledException extends DomainException {
  constructor(settlementId: string) {
    super(
      'EXPENSE_ALREADY_SETTLED',
      'El gasto ya se descontó en una liquidación: no se puede editar ni eliminar',
      DomainErrorKind.Conflict,
      { settlementId },
    )
  }
}
