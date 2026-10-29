import { EventsHandler, IEventHandler } from '@nestjs/cqrs'

import {
  PAYMENT_CONFIRMED_QUEUE,
  PAYMENT_VOIDED_QUEUE,
  PaymentConfirmedPayload,
  PaymentVoidedPayload,
} from '@/modules/billing/public/billing-events'
import { QueuePort } from '@/platform/queue/queue.port'
import { createLogger } from '@/shared/logging/root-logger'
import { PaymentConfirmedEvent, PaymentVoidedEvent } from './payment-events'

/**
 * Pasan los eventos de pagos del `EventBus` a sus colas de pg-boss, igual
 * que el de cuota saldada: liquidaciones (Fase 12) los consume para la
 * cuenta de honorarios y para reaccionar a una anulación ya liquidada.
 */
@EventsHandler(PaymentConfirmedEvent)
export class RelayPaymentConfirmedHandler implements IEventHandler<PaymentConfirmedEvent> {
  private readonly logger = createLogger('PaymentConfirmedRelay')

  constructor(private readonly queue: QueuePort) {}

  async handle(event: PaymentConfirmedEvent): Promise<void> {
    const { payment } = event
    const payload: PaymentConfirmedPayload = {
      paymentId: payment.id,
      installmentId: payment.installmentId,
      contractId: payment.contractId,
      ownerId: event.installment.ownerId,
      renterId: payment.renterId,
      period: event.installment.period,
      receivedBy: payment.receivedBy,
      kind: payment.kind,
      paidAt: payment.paidAt,
      rentApplied: payment.rentApplied,
      lateFeeApplied: payment.lateFeeApplied,
      chargesApplied: payment.chargesApplied,
      currency: event.currency,
    }
    try {
      await this.queue.publish(PAYMENT_CONFIRMED_QUEUE, payload)
    } catch (error) {
      this.logger.error(
        { err: error, paymentId: payment.id },
        'No se pudo publicar PaymentConfirmed en la cola',
      )
    }
  }
}

@EventsHandler(PaymentVoidedEvent)
export class RelayPaymentVoidedHandler implements IEventHandler<PaymentVoidedEvent> {
  private readonly logger = createLogger('PaymentVoidedRelay')

  constructor(private readonly queue: QueuePort) {}

  async handle(event: PaymentVoidedEvent): Promise<void> {
    const { payment } = event
    const payload: PaymentVoidedPayload = {
      paymentId: payment.id,
      installmentId: payment.installmentId,
      contractId: payment.contractId,
      ownerId: event.installment.ownerId,
      period: event.installment.period,
      settlementId: payment.settlementId,
      receivedBy: payment.receivedBy,
      paidAt: payment.paidAt,
      rentApplied: payment.rentApplied,
      lateFeeApplied: payment.lateFeeApplied,
      chargesApplied: payment.chargesApplied,
      currency: event.currency,
      voidReason: payment.voidReason ?? '',
    }
    try {
      await this.queue.publish(PAYMENT_VOIDED_QUEUE, payload)
    } catch (error) {
      this.logger.error(
        { err: error, paymentId: payment.id },
        'No se pudo publicar PaymentVoided en la cola',
      )
    }
  }
}
