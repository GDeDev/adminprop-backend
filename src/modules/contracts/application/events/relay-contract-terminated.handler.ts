import { EventsHandler, IEventHandler } from '@nestjs/cqrs'

import {
  CONTRACT_TERMINATED_BILLING_QUEUE,
  CONTRACT_TERMINATED_QUEUE,
  ContractTerminatedPayload,
} from '@/modules/contracts/public/contract-events'
import { QueuePort } from '@/platform/queue/queue.port'
import { createLogger } from '@/shared/logging/root-logger'
import { ContractTerminatedEvent } from './contract-terminated.event'

/**
 * Pasa la rescisión del `EventBus` a la cola, igual que los demás eventos: el
 * efecto (generar el PDF del cálculo) sobrevive a un reinicio y se reintenta.
 */
@EventsHandler(ContractTerminatedEvent)
export class RelayContractTerminatedHandler implements IEventHandler<ContractTerminatedEvent> {
  private readonly logger = createLogger('ContractTerminatedRelay')

  constructor(private readonly queue: QueuePort) {}

  async handle(event: ContractTerminatedEvent): Promise<void> {
    const payload: ContractTerminatedPayload = {
      contractId: event.contractId,
      notifiedAt: event.notifiedAt,
      penalty: event.penalty,
      futureRent: event.futureRent,
    }
    try {
      await this.queue.publish(CONTRACT_TERMINATED_QUEUE, payload)
      await this.queue.publish(CONTRACT_TERMINATED_BILLING_QUEUE, payload)
    } catch (error) {
      // La rescisión ya está registrada; el PDF se pide a mano con la
      // regeneración si hace falta.
      this.logger.error(
        { err: error, contractId: event.contractId },
        'No se pudo publicar ContractTerminated en la cola',
      )
    }
  }
}
