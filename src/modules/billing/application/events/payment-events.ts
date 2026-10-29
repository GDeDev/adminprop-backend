import { IEvent } from '@nestjs/cqrs'

import { Payment } from '@/modules/billing/domain/billing'

/**
 * Eventos internos de pagos (Fase 12). Hacia otros módulos viajan por
 * pg-boss como `PaymentConfirmedPayload` / `PaymentVoidedPayload` (ver
 * `public/billing-events.ts` y los relays).
 */

/** Un pago quedó CONFIRMED: al crearse si lo recibió la inmobiliaria, al confirmarse si lo recibió el propietario. */
export class PaymentConfirmedEvent implements IEvent {
  constructor(
    public readonly payment: Payment,
    public readonly installment: { ownerId: string; period: string },
    public readonly currency: string,
  ) {}
}

/** Un pago se anuló; `settlementId` dice si ya estaba liquidado. */
export class PaymentVoidedEvent implements IEvent {
  constructor(
    public readonly payment: Payment,
    public readonly installment: { ownerId: string; period: string },
    public readonly currency: string,
  ) {}
}
