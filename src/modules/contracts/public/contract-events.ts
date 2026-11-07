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

/**
 * Se rescindió un contrato (Fase 15). Contratos emite el evento adentro y un
 * relay lo publica acá; los PDFs generan el cálculo de la rescisión.
 */
export const CONTRACT_TERMINATED_QUEUE: QueueDefinition = {
  name: 'contract-terminated',
  retryLimit: 3,
  retryDelaySeconds: 5,
}

/**
 * Copia de `contract-terminated` para cobros (pg-boss entrega cada mensaje a
 * un solo consumidor y documentos ya consume la otra): cierra las cuotas de
 * los meses posteriores a la rescisión (revisión 2026-11-06, alto 7).
 */
export const CONTRACT_TERMINATED_BILLING_QUEUE: QueueDefinition = {
  name: 'contract-terminated-billing',
  retryLimit: 3,
  retryDelaySeconds: 5,
}

export interface ContractTerminatedPayload {
  contractId: string
  /** Fecha de la notificación, `AAAA-MM-DD`. */
  notifiedAt: string
  penalty: string
  futureRent: string
}
