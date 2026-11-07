import { DomainErrorKind, DomainException } from '@/shared/errors'

// ------------------------------------------------------------ Liquidaciones

export class SettlementNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'SETTLEMENT_NOT_FOUND',
      'La liquidación no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class SettlementAdjustmentNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'SETTLEMENT_ADJUSTMENT_NOT_FOUND',
      'El ajuste no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class SettlementTransferNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'SETTLEMENT_TRANSFER_NOT_FOUND',
      'La transferencia no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

/** El contrato no existe en esta inmobiliaria. */
export class SettlementInvalidContractException extends DomainException {
  constructor(contractId: string) {
    super(
      'SETTLEMENT_INVALID_CONTRACT',
      'El contrato no existe',
      DomainErrorKind.BusinessRule,
      { contractId },
    )
  }
}

/** Una sola liquidación pendiente por contrato (4.1). */
export class SettlementDraftExistsException extends DomainException {
  constructor(settlementId: string) {
    super(
      'SETTLEMENT_DRAFT_EXISTS',
      'El contrato ya tiene una liquidación pendiente: recalculala o confirmala',
      DomainErrorKind.Conflict,
      { settlementId },
    )
  }
}

export class SettlementNothingToSettleException extends DomainException {
  constructor(contractId: string) {
    super(
      'SETTLEMENT_NOTHING_TO_SETTLE',
      'No hay pagos cobrados por la inmobiliaria ni gastos adelantados pendientes para liquidar',
      DomainErrorKind.Conflict,
      { contractId },
    )
  }
}

/** Recalcular, ajustar o cancelar sólo sobre una pendiente (4.4). */
export class SettlementNotPendingException extends DomainException {
  constructor(id: string, status: string) {
    super(
      'SETTLEMENT_NOT_PENDING',
      'La liquidación ya no está pendiente: es inmutable',
      DomainErrorKind.Conflict,
      { id, status },
    )
  }
}

/**
 * Al confirmar, la pendiente ya no coincide con lo que se liquidaría hoy (un
 * pago anulado, un gasto corregido, un pago nuevo). Se recalcula y se pide
 * revisarla antes de confirmar.
 */
export class SettlementStaleException extends DomainException {
  constructor(id: string) {
    super(
      'SETTLEMENT_STALE',
      'La liquidación cambió desde el último cálculo (pagos o gastos nuevos, anulados o corregidos): se recalculó, revisala y volvé a confirmar',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

/** Los pagos o gastos de la liquidación ya no se pueden marcar como liquidados. */
export class SettlementLinesChangedException extends DomainException {
  constructor(id: string, what: 'payments' | 'expenses') {
    super(
      'SETTLEMENT_STALE',
      'Un pago o un gasto de la liquidación cambió mientras se confirmaba: recalculala y volvé a confirmar',
      DomainErrorKind.Conflict,
      { id, what },
    )
  }
}

/** Transferir o consolidar sólo sobre una confirmada o transferida. */
export class SettlementNotConfirmedException extends DomainException {
  constructor(id: string, status: string) {
    super(
      'SETTLEMENT_NOT_CONFIRMED',
      'La liquidación tiene que estar confirmada',
      DomainErrorKind.Conflict,
      { id, status },
    )
  }
}

export class SettlementAlreadyInStatementException extends DomainException {
  constructor(id: string, statementId: string) {
    super(
      'SETTLEMENT_ALREADY_IN_STATEMENT',
      'La liquidación ya pertenece a un consolidado',
      DomainErrorKind.Conflict,
      { id, statementId },
    )
  }
}

/** La liquidación es de otro propietario que el consolidado. */
export class SettlementOwnerMismatchException extends DomainException {
  constructor(id: string) {
    super(
      'SETTLEMENT_OWNER_MISMATCH',
      'La liquidación es de otro propietario',
      DomainErrorKind.BusinessRule,
      { id },
    )
  }
}

export class SettlementAdjustmentAlreadyVoidedException extends DomainException {
  constructor(id: string) {
    super(
      'SETTLEMENT_ADJUSTMENT_ALREADY_VOIDED',
      'El ajuste ya está anulado',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

export class SettlementTransferAlreadyVoidedException extends DomainException {
  constructor(id: string) {
    super(
      'SETTLEMENT_TRANSFER_ALREADY_VOIDED',
      'La transferencia ya está anulada',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

export class InvalidSettlementAmountException extends DomainException {
  constructor(
    reason = 'tiene que ser un número mayor que cero',
    field = 'amount',
  ) {
    super(
      'SETTLEMENT_INVALID_AMOUNT',
      `El monto no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field },
    )
  }
}

/** Las transferencias no pueden superar el neto (4.5). */
export class SettlementTransferExceedsNetException extends DomainException {
  constructor(net: string, remaining: string) {
    super(
      'SETTLEMENT_TRANSFER_EXCEEDS_NET',
      `La transferencia supera lo que falta transferir (${remaining} de un neto de ${net})`,
      DomainErrorKind.InvalidInput,
      { net, remaining },
    )
  }
}

export class InvalidSettlementReceiptException extends DomainException {
  constructor(reason: string) {
    super(
      'SETTLEMENT_INVALID_RECEIPT',
      `El comprobante no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field: 'file' },
    )
  }
}

export class InvalidSettlementDateException extends DomainException {
  constructor(reason: string, field = 'transferredAt') {
    super(
      'SETTLEMENT_INVALID_DATE',
      `La fecha no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field },
    )
  }
}

export class InvalidSettlementPeriodException extends DomainException {
  constructor() {
    super(
      'SETTLEMENT_INVALID_PERIOD',
      'El período tiene que ser un mes válido (AAAA-MM)',
      DomainErrorKind.InvalidInput,
      { field: 'period' },
    )
  }
}

export class InvalidSettlementTextException extends DomainException {
  constructor(field: string, reason: string) {
    super(
      'SETTLEMENT_INVALID_TEXT',
      `${field}: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field },
    )
  }
}

// ------------------------------------------------------------- Consolidados

export class StatementNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'STATEMENT_NOT_FOUND',
      'El consolidado no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class StatementInvalidOwnerException extends DomainException {
  constructor(ownerId: string) {
    super(
      'STATEMENT_INVALID_OWNER',
      'El propietario no existe',
      DomainErrorKind.BusinessRule,
      { ownerId },
    )
  }
}

/** Uno por propietario y mes (3.2). */
export class StatementPeriodTakenException extends DomainException {
  constructor(statementId: string) {
    super(
      'STATEMENT_PERIOD_TAKEN',
      'El propietario ya tiene un consolidado para ese mes',
      DomainErrorKind.Conflict,
      { statementId },
    )
  }
}

export class StatementNotOpenException extends DomainException {
  constructor(id: string) {
    super(
      'STATEMENT_NOT_OPEN',
      'El consolidado está cerrado: reabrilo para cambiarlo',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

export class StatementNotClosedException extends DomainException {
  constructor(id: string) {
    super(
      'STATEMENT_NOT_CLOSED',
      'El consolidado ya está abierto',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

// --------------------------------------------------------------- Honorarios

export class FeeReceivableNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'FEE_RECEIVABLE_NOT_FOUND',
      'El honorario a cobrar no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class FeePaymentNotFoundException extends DomainException {
  constructor(id: string) {
    super(
      'FEE_PAYMENT_NOT_FOUND',
      'El pago de honorarios no existe',
      DomainErrorKind.NotFound,
      { id },
    )
  }
}

export class FeePaymentAlreadyVoidedException extends DomainException {
  constructor(id: string) {
    super(
      'FEE_PAYMENT_ALREADY_VOIDED',
      'El pago de honorarios ya está anulado',
      DomainErrorKind.Conflict,
      { id },
    )
  }
}

export class InvalidFeePaymentAmountException extends DomainException {
  constructor(reason = 'tiene que ser un número mayor que cero') {
    super(
      'FEE_PAYMENT_INVALID_AMOUNT',
      `El monto no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field: 'amount' },
    )
  }
}

export class FeePaymentInvalidOwnerException extends DomainException {
  constructor(ownerId: string) {
    super(
      'FEE_PAYMENT_INVALID_OWNER',
      'El propietario no existe',
      DomainErrorKind.BusinessRule,
      { ownerId },
    )
  }
}

/** El contrato del pago de honorarios no es del propietario. */
export class FeePaymentInvalidContractException extends DomainException {
  constructor(contractId: string) {
    super(
      'FEE_PAYMENT_INVALID_CONTRACT',
      'El contrato no existe o no es de este propietario',
      DomainErrorKind.BusinessRule,
      { contractId },
    )
  }
}

/** El propietario quiere acusar recibo de una liquidación sin transferencias (Fase 17). */
export class SettlementNothingToAcknowledgeException extends DomainException {
  constructor(id: string) {
    super(
      'SETTLEMENT_NOTHING_TO_ACKNOWLEDGE',
      'Todavía no hay una transferencia registrada para esta liquidación',
      DomainErrorKind.BusinessRule,
      { id },
    )
  }
}
