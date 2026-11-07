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

/**
 * Un pago con fecha anterior a otro vigente que ya cobró punitorio bajaría el
 * punitorio devengado por debajo de lo ya cobrado, y el excedente se perdía
 * (revisión 2026-11-06, alto 5). Se pide anular y cargar en orden.
 */
export class PaymentDateBeforeLateFeePaymentException extends DomainException {
  constructor(paymentId: string, paidAt: string) {
    super(
      'PAYMENT_DATE_BEFORE_LATE_FEE_PAYMENT',
      `Hay un pago del ${paidAt} que ya cobró punitorio: un pago con fecha anterior cambia ese punitorio. Anulá ese pago, cargá este y volvé a cargarlo`,
      DomainErrorKind.Conflict,
      { paymentId, paidAt },
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

// ---------------------------------------------------------------- Depósito

export class DepositReturnExistsException extends DomainException {
  constructor(contractId: string) {
    super(
      'DEPOSIT_RETURN_EXISTS',
      'El depósito de este contrato ya se devolvió',
      DomainErrorKind.Conflict,
      { contractId },
    )
  }
}

/** Sólo se devuelve al cerrar las cuentas: contrato finalizado, rescindido o vencido. */
export class DepositReturnContractActiveException extends DomainException {
  constructor(contractId: string) {
    super(
      'DEPOSIT_RETURN_CONTRACT_ACTIVE',
      'El contrato sigue vigente: el depósito se devuelve al terminar',
      DomainErrorKind.Conflict,
      { contractId },
    )
  }
}

/** `returnedAmount + Σ deducciones` tiene que ser exactamente el monto de referencia. */
export class DepositReturnUnbalancedException extends DomainException {
  constructor(reference: string, accounted: string) {
    super(
      'DEPOSIT_RETURN_UNBALANCED',
      `Lo devuelto más las deducciones (${accounted}) tiene que ser igual al monto a devolver según el contrato (${reference})`,
      DomainErrorKind.InvalidInput,
      { reference, accounted },
    )
  }
}

/** Las deducciones no pueden superar el monto de referencia de la devolución. */
export class DepositDeductionsExceedReferenceException extends DomainException {
  constructor(reference: string, deductions: string) {
    super(
      'DEPOSIT_RETURN_DEDUCTIONS_EXCEED',
      `Las deducciones (${deductions}) superan el monto a devolver según el contrato (${reference})`,
      DomainErrorKind.InvalidInput,
      { reference, deductions },
    )
  }
}

/** Falta el monto de referencia (modo manual o alquiler en otra moneda) o no coincide. */
export class InvalidDepositReferenceException extends DomainException {
  constructor(reason: string) {
    super(
      'DEPOSIT_RETURN_INVALID_REFERENCE',
      `El monto a devolver según el contrato no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field: 'referenceAmount' },
    )
  }
}

export class InvalidDepositDeductionException extends DomainException {
  constructor(reason: string) {
    super(
      'DEPOSIT_RETURN_INVALID_DEDUCTION',
      `La deducción no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field: 'deductions' },
    )
  }
}

export class InvalidDepositReturnDateException extends DomainException {
  constructor(reason: string) {
    super(
      'DEPOSIT_RETURN_INVALID_DATE',
      `La fecha de devolución no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field: 'returnedAt' },
    )
  }
}
