import {
  PaymentMethod,
  SettlementAdjustmentConcept,
} from '../../domain/settlement'

/** `POST /settlements { contractId, period? }` (4.1). */
export class CreateSettlementCommand {
  constructor(
    public readonly contractId: string,
    public readonly period: string | null,
  ) {}
}

export class RecalculateSettlementCommand {
  constructor(public readonly settlementId: string) {}
}

export class CreateSettlementAdjustmentCommand {
  constructor(
    public readonly settlementId: string,
    public readonly data: {
      concept: SettlementAdjustmentConcept
      description: string
      amount: string
    },
  ) {}
}

export class VoidSettlementAdjustmentCommand {
  constructor(
    public readonly adjustmentId: string,
    public readonly reason: string,
  ) {}
}

export class ConfirmSettlementCommand {
  constructor(public readonly settlementId: string) {}
}

/** Sólo admin, sólo pendiente. */
export class CancelSettlementCommand {
  constructor(
    public readonly settlementId: string,
    public readonly reason: string,
  ) {}
}

/** Lo que llega del multipart. */
export class RegisterSettlementTransferCommand {
  constructor(
    public readonly settlementId: string,
    public readonly data: {
      transferredAt: string
      amount: string
      method: PaymentMethod
      notes: string | null
    },
    /** El comprobante tal como llegó; vacío si no mandaron archivo. */
    public readonly receipt: Buffer,
  ) {}
}

/** Sólo admin (A-18). */
export class VoidSettlementTransferCommand {
  constructor(
    public readonly transferId: string,
    public readonly reason: string,
  ) {}
}
