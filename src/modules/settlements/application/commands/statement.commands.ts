import {
  FeePayer,
  PaymentMethod,
  StatementSendMode,
} from '../../domain/settlement'

// ------------------------------------------------------------- Consolidados

export class CreateStatementCommand {
  constructor(
    public readonly ownerId: string,
    public readonly period: string,
  ) {}
}

export class AddStatementSettlementsCommand {
  constructor(
    public readonly statementId: string,
    public readonly settlementIds: string[],
  ) {}
}

export class RemoveStatementSettlementCommand {
  constructor(
    public readonly statementId: string,
    public readonly settlementId: string,
  ) {}
}

export class CloseStatementCommand {
  constructor(
    public readonly statementId: string,
    public readonly sendMode: StatementSendMode | null,
  ) {}
}

/** Sólo admin. */
export class ReopenStatementCommand {
  constructor(public readonly statementId: string) {}
}

// --------------------------------------------------------------- Honorarios

/** Lo que llega del multipart. */
export class RegisterFeePaymentCommand {
  constructor(
    public readonly data: {
      ownerId: string
      contractId: string | null
      paidAt: string
      amount: string
      currency: string
      method: PaymentMethod
      paidBy: FeePayer
      notes: string | null
    },
    /** El comprobante tal como llegó; vacío si no mandaron archivo. */
    public readonly receipt: Buffer,
  ) {}
}

/** Sólo admin: deshace las imputaciones. */
export class VoidFeePaymentCommand {
  constructor(
    public readonly paymentId: string,
    public readonly reason: string,
  ) {}
}

/** Aplica el saldo sin imputar de un pago a los receivables pendientes. */
export class AllocateFeePaymentCommand {
  constructor(public readonly paymentId: string) {}
}
