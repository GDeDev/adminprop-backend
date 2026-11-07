import { EventsHandler, IEventHandler } from '@nestjs/cqrs'

import {
  CONTRACT_RENT_UPDATED_QUEUE,
  ContractRentUpdatedPayload,
} from '@/modules/contracts/public/contract-events'
import { QueuePort } from '@/platform/queue/queue.port'
import { createLogger } from '@/shared/logging/root-logger'
import { RentUpdateAppliedEvent } from './rent-update-applied.event'

/**
 * Pasa el aumento aplicado del `EventBus` a la cola, igual que los eventos de
 * cobros: el efecto (corregir cuotas) sobrevive a un reinicio y se reintenta.
 */
@EventsHandler(RentUpdateAppliedEvent)
export class RelayRentUpdateAppliedHandler implements IEventHandler<RentUpdateAppliedEvent> {
  private readonly logger = createLogger('RentUpdateAppliedRelay')

  constructor(private readonly queue: QueuePort) {}

  async handle(event: RentUpdateAppliedEvent): Promise<void> {
    const payload: ContractRentUpdatedPayload = {
      contractId: event.contractId,
      effectiveFrom: event.effectiveFrom,
      previousRent: event.previousRent,
      newRent: event.newRent,
    }
    try {
      await this.queue.publish(CONTRACT_RENT_UPDATED_QUEUE, payload)
    } catch (error) {
      // El aumento ya está aplicado; lo que se pierde es la corrección de
      // cuotas, que queda visible en los logs y se hace a mano.
      this.logger.error(
        { err: error, contractId: event.contractId },
        'No se pudo publicar RentUpdateApplied en la cola',
      )
    }
  }
}
