import { Injectable, OnModuleInit } from '@nestjs/common'

import {
  PAYMENT_CONFIRMED_DOCUMENTS_QUEUE,
  PAYMENT_VOIDED_DOCUMENTS_QUEUE,
  PaymentConfirmedPayload,
  PaymentVoidedPayload,
} from '@/modules/billing/public'
import {
  CONTRACT_TERMINATED_QUEUE,
  ContractTerminatedPayload,
} from '@/modules/contracts/public'
import {
  SETTLEMENT_CONFIRMED_DOCUMENTS_QUEUE,
  SettlementConfirmedPayload,
  STATEMENT_CLOSED_DOCUMENTS_QUEUE,
  StatementClosedPayload,
} from '@/modules/settlements/public'
import {
  QueueDefinition,
  QueuePort,
  QueueMessage,
} from '@/platform/queue/queue.port'
import { createLogger } from '@/shared/logging/root-logger'
import {
  DOCUMENT_REGENERATE_QUEUE,
  DocumentRegeneratePayload,
} from '../../application/document-queues'
import { DocumentGenerator } from '../../application/document-generator'
import { DocumentKind } from '../../domain/document'

/**
 * Se suscribe a los eventos que disparan un PDF (Fase 15, 3) y a la cola de
 * regeneración manual. Cada intento corre dentro del tenant del mensaje; si
 * falla, pg-boss reintenta (3 veces, 30 s con backoff). Agotados los
 * reintentos la versión queda `FAILED` y el personal recibe `DOCUMENT_FAILED`:
 * el mensaje se da por consumido para no duplicar la dead-letter.
 */
@Injectable()
export class DocumentEventsConsumer implements OnModuleInit {
  private readonly logger = createLogger('DocumentEventsConsumer')

  constructor(
    private readonly queue: QueuePort,
    private readonly generator: DocumentGenerator,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.on<SettlementConfirmedPayload>(
      SETTLEMENT_CONFIRMED_DOCUMENTS_QUEUE,
      (p) => ({ kind: DocumentKind.SETTLEMENT, entityId: p.settlementId }),
    )
    await this.on<StatementClosedPayload>(
      STATEMENT_CLOSED_DOCUMENTS_QUEUE,
      (p) => ({ kind: DocumentKind.OWNER_STATEMENT, entityId: p.statementId }),
    )
    await this.on<PaymentConfirmedPayload>(
      PAYMENT_CONFIRMED_DOCUMENTS_QUEUE,
      // A-33: recibo sólo por cobros reales, no por aplicaciones de saldo a favor.
      (p) =>
        p.kind === 'CASH_IN'
          ? { kind: DocumentKind.PAYMENT_RECEIPT, entityId: p.paymentId }
          : null,
    )
    await this.on<PaymentVoidedPayload>(
      PAYMENT_VOIDED_DOCUMENTS_QUEUE,
      (p) => ({ kind: DocumentKind.PAYMENT_RECEIPT, entityId: p.paymentId }),
    )
    await this.on<ContractTerminatedPayload>(
      CONTRACT_TERMINATED_QUEUE,
      (p) => ({
        kind: DocumentKind.TERMINATION_NOTICE,
        entityId: p.contractId,
      }),
    )
    await this.on<DocumentRegeneratePayload>(
      DOCUMENT_REGENERATE_QUEUE,
      (p) => ({
        kind: p.kind,
        entityId: p.entityId,
        documentId: p.documentId,
        requestedById: p.requestedById,
        force: true,
      }),
    )
  }

  private on<T extends object>(
    definition: QueueDefinition,
    target: (payload: T) => {
      kind: DocumentKind
      entityId: string
      documentId?: string
      requestedById?: string
      force?: boolean
    } | null,
  ): Promise<void> {
    return this.queue.consume<T>(definition, (message) =>
      this.handle(definition, message, target),
    )
  }

  private async handle<T extends object>(
    definition: QueueDefinition,
    message: QueueMessage<T>,
    target: (payload: T) => {
      kind: DocumentKind
      entityId: string
      documentId?: string
      requestedById?: string
      force?: boolean
    } | null,
  ): Promise<void> {
    const request = target(message.payload)
    if (!request) return
    try {
      await this.generator.generate(request)
    } catch (error) {
      const lastAttempt = message.retryCount >= (definition.retryLimit ?? 3)
      this.logger.warn(
        { err: error, queue: definition.name, ...request, lastAttempt },
        'No se pudo generar el documento',
      )
      if (!lastAttempt) throw error
      await this.generator.fail(
        request.kind,
        request.entityId,
        error,
        request.documentId,
      )
    }
  }
}
