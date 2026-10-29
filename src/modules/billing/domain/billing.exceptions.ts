import { DomainErrorKind, DomainException } from '@/shared/errors'

// ------------------------------------------------------------------ Cuotas

export class InstallmentNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'INSTALLMENT_NOT_FOUND',
      'La cuota no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

/** Un pago sobre una cuota sin saldo. */
export class InstallmentAlreadyPaidException extends DomainException {
  constructor(id: string) {
    super(
      'INSTALLMENT_ALREADY_PAID',
      'La cuota ya está saldada: no queda nada por cobrar',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

export class InvalidInstallmentPeriodException extends DomainException {
  constructor() {
    super(
      'INSTALLMENT_INVALID_PERIOD',
      'El período tiene que ser un mes válido (AAAA-MM)',
      DomainErrorKind.InvalidInput,
      { field: 'period' },
    )
  }
}

/** El contrato de la cuenta corriente no existe o es de otra inmobiliaria. */
export class InstallmentInvalidContractException extends DomainException {
  constructor(contractId: string) {
    super(
      'INSTALLMENT_INVALID_CONTRACT',
      'El contrato no existe',
      DomainErrorKind.BusinessRule,
      { contractId },
    )
  }
}

export class InvalidInstallmentDateException extends DomainException {
  constructor(field: string, reason: string) {
    super(
      'INSTALLMENT_INVALID_DATE',
      `La fecha no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field },
    )
  }
}

// ------------------------------------------------------------------- Pagos

export class PaymentNotFoundException extends DomainException {
  constructor(id: string) {
    super('PAYMENT_NOT_FOUND', 'El pago no existe', DomainErrorKind.NotFound, {
      id,
    })
  }
}

export class InvalidPaymentAmountException extends DomainException {
  constructor(reason = 'tiene que ser un número mayor que cero') {
    super(
      'PAYMENT_INVALID_AMOUNT',
      `El monto no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field: 'amount' },
    )
  }
}

export class InvalidPaymentDateException extends DomainException {
  constructor(reason: string, field = 'paidAt') {
    super(
      'PAYMENT_INVALID_DATE',
      `La fecha no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field },
    )
  }
}

/** Pago en otra moneda que la de la cuota sin cotización completa (A-9). */
export class ExchangeRateRequiredException extends DomainException {
  constructor() {
    super(
      'PAYMENT_EXCHANGE_RATE_REQUIRED',
      'El pago está en otra moneda que la cuota: indicá cotización, fuente y fecha',
      DomainErrorKind.InvalidInput,
      { field: 'exchangeRate' },
    )
  }
}

export class ExchangeRateNotAllowedException extends DomainException {
  constructor() {
    super(
      'PAYMENT_EXCHANGE_RATE_NOT_ALLOWED',
      'El pago está en la moneda de la cuota: no lleva cotización',
      DomainErrorKind.InvalidInput,
      { field: 'exchangeRate' },
    )
  }
}

export class InvalidAllocationException extends DomainException {
  constructor(reason: string) {
    super(
      'PAYMENT_INVALID_ALLOCATION',
      `La imputación no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field: 'allocation' },
    )
  }
}

export class InvalidPaymentReceiptException extends DomainException {
  constructor(reason: string) {
    super(
      'PAYMENT_INVALID_RECEIPT',
      `El comprobante no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field: 'file' },
    )
  }
}

export class PaymentAlreadyVoidedException extends DomainException {
  constructor(id: string) {
    super(
      'PAYMENT_ALREADY_VOIDED',
      'El pago ya está anulado',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

export class PaymentAlreadyConfirmedException extends DomainException {
  constructor(id: string) {
    super(
      'PAYMENT_ALREADY_CONFIRMED',
      'El pago ya está confirmado',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

/** El crédito que generó el pago ya se usó, en parte o entero. */
export class PaymentCreditAlreadyUsedException extends DomainException {
  constructor(creditId: string) {
    super(
      'PAYMENT_CREDIT_ALREADY_USED',
      'El saldo a favor que generó este pago ya se aplicó o se devolvió: anulá primero esas aplicaciones',
      DomainErrorKind.Conflict,
      { creditId },
    )
  }
}

// ------------------------------------------------------------------ Cargos

export class ChargeNotFoundException extends DomainException {
  constructor(id: string) {
    super('CHARGE_NOT_FOUND', 'El cargo no existe', DomainErrorKind.NotFound, {
      id,
    })
  }
}

export class InvalidChargeAmountException extends DomainException {
  constructor(reason = 'tiene que ser un número mayor que cero') {
    super(
      'CHARGE_INVALID_AMOUNT',
      `El monto del cargo no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field: 'amount' },
    )
  }
}

/** Ya se imputaron pagos a los cargos: anularlo dejaría el saldo en negativo. */
export class ChargeHasAllocationsException extends DomainException {
  constructor(id: string) {
    super(
      'CHARGE_HAS_ALLOCATIONS',
      'El cargo ya tiene pagos imputados: anulá antes esos pagos',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

export class ChargeAlreadyVoidedException extends DomainException {
  constructor(id: string) {
    super(
      'CHARGE_ALREADY_VOIDED',
      'El cargo ya está anulado',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

// ---------------------------------------------------------------- Créditos

export class CreditNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'CREDIT_NOT_FOUND',
      'El saldo a favor no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

/** Nada que aplicar o devolver: sin crédito disponible, o ya usado. */
export class CreditNotAvailableException extends DomainException {
  constructor(reason = 'no hay saldo a favor disponible') {
    super(
      'CREDIT_NOT_AVAILABLE',
      `No se pudo aplicar el saldo a favor: ${reason}`,
      DomainErrorKind.Conflict,
    )
  }
}

export class CreditCurrencyMismatchException extends DomainException {
  constructor() {
    super(
      'CREDIT_CURRENCY_MISMATCH',
      'El saldo a favor está en otra moneda que la cuota',
      DomainErrorKind.Conflict,
    )
  }
}

export class CreditRenterNotFoundException extends DomainException {
  constructor(renterId: string) {
    super(
      'CREDIT_RENTER_NOT_FOUND',
      'El inquilino no existe',
      DomainErrorKind.NotFound,
      { renterId },
    )
  }
}

// -------------------------------------------------------------- Punitorios

export class InvalidLateFeeAdjustmentException extends DomainException {
  constructor(reason: string) {
    super(
      'LATE_FEE_INVALID_ADJUSTMENT',
      `El ajuste del punitorio no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
    )
  }
}
