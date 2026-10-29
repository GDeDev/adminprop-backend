import {
  ChargeConcept,
  Currency,
  ExchangeRateSource,
  LateFeeAdjustmentKind,
  PaymentMethod,
  PaymentReceiver,
} from '../../domain/billing'

/** Genera las cuotas de un mes; sin período, el mes siguiente (spec 3.1). */
export class GenerateInstallmentsCommand {
  constructor(public readonly period: string | null) {}
}

export class CreateChargeCommand {
  constructor(
    public readonly installmentId: string,
    public readonly data: {
      concept: ChargeConcept
      description: string
      amount: string
    },
  ) {}
}

export class VoidChargeCommand {
  constructor(
    public readonly chargeId: string,
    public readonly reason: string,
  ) {}
}

/** Lo que llega del multipart; `allocation` es un string JSON. */
export interface RegisterPaymentInput {
  paidAt: string
  amount: string
  paidCurrency: Currency
  exchangeRate: string | null
  exchangeRateSource: ExchangeRateSource | null
  exchangeRateDate: string | null
  method: PaymentMethod
  receivedBy: PaymentReceiver | null
  allocation: string | null
  /** Default true: aplica antes los saldos a favor del inquilino. */
  applyCredit: boolean
  notes: string | null
}

export class RegisterPaymentCommand {
  constructor(
    public readonly installmentId: string,
    public readonly data: RegisterPaymentInput,
    /** El comprobante tal como llegó; vacío si no mandaron archivo. */
    public readonly receipt: Buffer,
  ) {}
}

export class ApplyCreditCommand {
  constructor(
    public readonly installmentId: string,
    public readonly creditId: string | undefined,
    public readonly amount: string | undefined,
  ) {}
}

export class ConfirmPaymentCommand {
  constructor(public readonly paymentId: string) {}
}

export class VoidPaymentCommand {
  constructor(
    public readonly paymentId: string,
    public readonly reason: string,
  ) {}
}

export class AdjustLateFeeCommand {
  constructor(
    public readonly installmentId: string,
    public readonly kind: LateFeeAdjustmentKind,
    public readonly amount: string | null,
    public readonly reason: string,
  ) {}
}

export class RefundCreditCommand {
  constructor(
    public readonly creditId: string,
    public readonly refundedAt: string,
    public readonly method: PaymentMethod,
    public readonly notes: string | null,
  ) {}
}
