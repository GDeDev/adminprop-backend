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
