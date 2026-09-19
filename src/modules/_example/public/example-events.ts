import { QueueDefinition } from '@/platform/queue/queue.port'

/**
 * Contrato del evento "se creó un ítem" hacia otros módulos.
 *
 * Adentro de `_example` el evento se emite por el `EventBus` de CQRS; un relay
 * lo publica en esta cola de pg-boss, que es lo que escuchan los demás
 * (spec Fase 1, 5.1, punto 3). Otro módulo sólo conoce esto: la cola y la
 * forma del payload, nunca las clases internas de `_example`.
 */
export const EXAMPLE_ITEM_CREATED_QUEUE: QueueDefinition = {
  name: 'example-item-created',
  retryLimit: 3,
  retryDelaySeconds: 5,
}

export interface ExampleItemCreatedPayload {
  exampleItemId: string
  name: string
  /** Dinero como string, igual que en toda la app. */
  price: string
}
