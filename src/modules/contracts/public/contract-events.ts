import { QueueDefinition } from '@/platform/queue/queue.port'

/**
 * Contrato del evento "se aplicó un aumento" hacia otros módulos. Adentro de
 * contratos se emite por el `EventBus`; un relay lo publica en esta cola de
 * pg-boss. Cobros lo escucha para corregir la base de las cuotas ya
 * generadas (Fase 13, 2.1) y funciona igual con el aumento manual que con el
 * del cron.
 */
export const CONTRACT_RENT_UPDATED_QUEUE: QueueDefinition = {
  name: 'contract-rent-updated',
  retryLimit: 3,
  retryDelaySeconds: 5,
}

export interface ContractRentUpdatedPayload {
  contractId: string
  /** Primer día desde el que rige el nuevo alquiler. */
  effectiveFrom: string
  previousRent: string
  newRent: string
}
