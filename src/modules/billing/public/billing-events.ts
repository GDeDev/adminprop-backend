import { QueueDefinition } from '@/platform/queue/queue.port'

/**
 * Contrato del evento "la cuota quedó saldada" hacia otros módulos. Adentro
 * de cobros se emite por el `EventBus`; un relay lo publica en esta cola de
 * pg-boss, que es lo que escucha la Fase 12 para generar la liquidación.
 */
export const INSTALLMENT_PAID_QUEUE: QueueDefinition = {
  name: 'installment-paid',
  retryLimit: 3,
  retryDelaySeconds: 5,
}

export interface InstallmentPaidPayload {
  installmentId: string
  contractId: string
  ownerId: string
  /** `AAAA-MM`. */
  period: string
}

/**
 * Un pago quedó CONFIRMED (Fase 12, 2.2): al crearse si lo recibió la
 * inmobiliaria (o es una aplicación de saldo a favor), al confirmarse si lo
 * recibió el propietario. Liquidaciones devenga el honorario de los
 * cobrados por el propietario (`receivedBy: OWNER`).
 */
export const PAYMENT_CONFIRMED_QUEUE: QueueDefinition = {
  name: 'payment-confirmed',
  retryLimit: 3,
  retryDelaySeconds: 5,
}

export interface PaymentConfirmedPayload {
  paymentId: string
  installmentId: string
  contractId: string
  ownerId: string
  renterId: string
  /** `AAAA-MM` de la cuota. */
  period: string
  receivedBy: 'AGENCY' | 'OWNER'
  kind: 'CASH_IN' | 'CREDIT_APPLICATION'
  paidAt: string
  /** Imputación en moneda del contrato. */
  rentApplied: string
  lateFeeApplied: string
  chargesApplied: string
  currency: string
}

/**
 * Un pago se anuló. Si tenía liquidación (`settlementId`), liquidaciones
 * recalcula la pendiente o descuenta la diferencia en la siguiente (A-19).
 */
export const PAYMENT_VOIDED_QUEUE: QueueDefinition = {
  name: 'payment-voided',
  retryLimit: 3,
  retryDelaySeconds: 5,
}

export interface PaymentVoidedPayload {
  paymentId: string
  installmentId: string
  contractId: string
  ownerId: string
  period: string
  settlementId: string | null
  receivedBy: 'AGENCY' | 'OWNER'
  paidAt: string
  rentApplied: string
  lateFeeApplied: string
  chargesApplied: string
  currency: string
  voidReason: string
}
