import { EventsHandler, IEvent, IEventHandler } from '@nestjs/cqrs'

import {
  SETTLEMENT_CONFIRMED_DOCUMENTS_QUEUE,
  SETTLEMENT_CONFIRMED_QUEUE,
  STATEMENT_CLOSED_DOCUMENTS_QUEUE,
  STATEMENT_CLOSED_QUEUE,
  SettlementConfirmedPayload,
  StatementClosedPayload,
} from '@/modules/settlements/public/settlement-events'
import { QueuePort } from '@/platform/queue/queue.port'
import { createLogger } from '@/shared/logging/root-logger'
import { OwnerStatement, Settlement } from '../../domain/settlement'

/** Una liquidación quedó confirmada (4.4). */
export class SettlementConfirmedEvent implements IEvent {
  constructor(public readonly settlement: Settlement) {}
}

/** Un consolidado se cerró (4.7). */
export class StatementClosedEvent implements IEvent {
  constructor(
    public readonly statement: OwnerStatement,
    public readonly members: Settlement[] = [],
  ) {}
}

/**
 * Pasan los eventos del `EventBus` a sus colas de pg-boss, igual que en
 * cobros: el efecto sobrevive a un reinicio y se reintenta.
 */
@EventsHandler(SettlementConfirmedEvent)
export class RelaySettlementConfirmedHandler implements IEventHandler<SettlementConfirmedEvent> {
  private readonly logger = createLogger('SettlementConfirmedRelay')

  constructor(private readonly queue: QueuePort) {}

  async handle(event: SettlementConfirmedEvent): Promise<void> {
    const { settlement } = event
    const payload: SettlementConfirmedPayload = {
      settlementId: settlement.id,
      ownerId: settlement.ownerId,
      contractId: settlement.contractId,
      period: settlement.period,
      netAmount: settlement.netAmount,
      currency: settlement.currency,
    }
    try {
      await this.queue.publish(SETTLEMENT_CONFIRMED_QUEUE, payload)
      await this.queue.publish(SETTLEMENT_CONFIRMED_DOCUMENTS_QUEUE, payload)
    } catch (error) {
      this.logger.error(
        { err: error, settlementId: settlement.id },
        'No se pudo publicar SettlementConfirmed en la cola',
      )
    }
  }
}

@EventsHandler(StatementClosedEvent)
export class RelayStatementClosedHandler implements IEventHandler<StatementClosedEvent> {
  private readonly logger = createLogger('StatementClosedRelay')

  constructor(private readonly queue: QueuePort) {}

  async handle(event: StatementClosedEvent): Promise<void> {
    const { statement, members } = event
    const payload: StatementClosedPayload = {
      statementId: statement.id,
      ownerId: statement.ownerId,
      period: statement.period,
      sendMode: statement.sendMode,
      settlements: members.map((settlement) => ({
        settlementId: settlement.id,
        ownerId: settlement.ownerId,
        contractId: settlement.contractId,
        period: settlement.period,
        netAmount: settlement.netAmount,
        currency: settlement.currency,
      })),
    }
    try {
      await this.queue.publish(STATEMENT_CLOSED_QUEUE, payload)
      await this.queue.publish(STATEMENT_CLOSED_DOCUMENTS_QUEUE, payload)
    } catch (error) {
      this.logger.error(
        { err: error, statementId: statement.id },
        'No se pudo publicar StatementClosed en la cola',
      )
    }
  }
}
