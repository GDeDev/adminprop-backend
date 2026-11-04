import { QueuePort } from '../../src/platform/queue/queue.port'

/**
 * Hace que registrar dos consumidores sobre la misma cola, dentro de la misma
 * app, falle al instante y diga cuál.
 *
 * En pg-boss los consumidores de una cola compiten: cada mensaje lo toma uno
 * solo. Si un test se suscribe a una cola que un módulo ya consume, el mensaje
 * cae en uno u otro al azar y el test descubre el problema como un timeout de
 * `waitFor`, mucho después y sin pista. Para observar lo que se publica, hay que
 * espiar `QueuePort.publish`, no consumir.
 */
export function rejectDuplicateConsumers(queue: QueuePort): void {
  const consumed = new Set<string>()
  const realConsume = queue.consume.bind(queue) as QueuePort['consume']

  // Asignación directa y no `jest.spyOn`: el `clearAllMocks` de `setup.ts`
  // corre en cada `beforeEach` y no tiene que poder desarmar el guardia.
  queue.consume = (async (definition, handler) => {
    if (consumed.has(definition.name)) {
      throw new Error(
        `La cola "${definition.name}" ya tiene un consumidor en esta app. ` +
          'Un segundo consumidor competiría con el primero por cada mensaje. ' +
          'Para ver lo que se publica, espiá QueuePort.publish con jest.spyOn.',
      )
    }
    consumed.add(definition.name)
    return realConsume(definition, handler)
  }) as QueuePort['consume']
}
