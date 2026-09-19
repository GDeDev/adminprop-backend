import { EventsHandler, IEventHandler } from '@nestjs/cqrs'

import {
  EXAMPLE_ITEM_CREATED_QUEUE,
  ExampleItemCreatedPayload,
} from '@/modules/_example/public/example-events'
import { QueuePort } from '@/platform/queue/queue.port'
import { createLogger } from '@/shared/logging/root-logger'
import { ExampleItemCreatedEvent } from './example-item-created.event'

/**
 * Pasa el evento del `EventBus` a la cola: el transporte real entre módulos es
 * pg-boss, así el efecto sobrevive a un reinicio y se reintenta (spec Fase 1,
 * 5.1, punto 3). Mañana, con SQS, cambia el adapter de la cola y nada más.
 *
 * Corre dentro del request que creó el ítem, así que el mensaje sale con su
 * tenant y su correlationId.
 */
@EventsHandler(ExampleItemCreatedEvent)
export class RelayExampleItemCreatedHandler implements IEventHandler<ExampleItemCreatedEvent> {
  private readonly logger = createLogger('ExampleItemCreatedRelay')

  constructor(private readonly queue: QueuePort) {}

  async handle(event: ExampleItemCreatedEvent): Promise<void> {
    const payload: ExampleItemCreatedPayload = {
      exampleItemId: event.exampleItemId,
      name: event.name,
      price: event.price,
    }

    try {
      await this.queue.publish(EXAMPLE_ITEM_CREATED_QUEUE, payload)
    } catch (error) {
      // El EventBus no espera a sus handlers: un error acá no le llega a
      // nadie si no se loguea. El ítem ya está creado; lo que se pierde es el
      // aviso. Si un evento no puede perderse nunca, el patrón es un outbox
      // (escribir el evento en la misma transacción que el ítem).
      this.logger.error(
        { err: error, exampleItemId: event.exampleItemId },
        'No se pudo publicar ExampleItemCreated en la cola',
      )
    }
  }
}
