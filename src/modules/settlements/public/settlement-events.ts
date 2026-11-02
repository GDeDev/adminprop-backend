import { QueueDefinition } from '@/platform/queue/queue.port'

/**
 * Contratos de los eventos de liquidaciones hacia otros módulos (sección
 * 6). Adentro se emiten por el `EventBus`; un relay los publica en pg-boss.
 * Los consumen el email (Fase 14) y los PDFs (Fase 15).
 */
export const SETTLEMENT_CONFIRMED_QUEUE: QueueDefinition = {
  name: 'settlement-confirmed',
  retryLimit: 3,
  retryDelaySeconds: 5,
}

export interface SettlementConfirmedPayload {
  settlementId: string
  ownerId: string
  contractId: string
  /** `AAAA-MM`. */
  period: string
  netAmount: string
  currency: string
}

export const STATEMENT_CLOSED_QUEUE: QueueDefinition = {
  name: 'statement-closed',
  retryLimit: 3,
  retryDelaySeconds: 5,
}

export interface StatementClosedPayload {
  statementId: string
  ownerId: string
  period: string
  sendMode: 'SUMMARY' | 'RECEIPTS' | 'BOTH'
}

/**
 * pg-boss entrega cada mensaje a un solo consumidor: el que necesita una copia
 * propia (los PDFs de la Fase 15) tiene su cola, y el relay publica en las dos.
 */
export const SETTLEMENT_CONFIRMED_DOCUMENTS_QUEUE: QueueDefinition = {
  name: 'settlement-confirmed-documents',
  retryLimit: 3,
  retryDelaySeconds: 30,
}

export const STATEMENT_CLOSED_DOCUMENTS_QUEUE: QueueDefinition = {
  name: 'statement-closed-documents',
  retryLimit: 3,
  retryDelaySeconds: 30,
}
