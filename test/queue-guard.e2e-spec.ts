import { INestApplication } from '@nestjs/common'

import { QueuePort } from '../src/platform/queue/queue.port'
import { createTestApp } from './utils/app'
import { rejectDuplicateConsumers } from './utils/queue-guard'

/** Fake mínimo: lo que importa es cuántas veces llega `consume` al real. */
function fakeQueue() {
  const consume = jest.fn().mockResolvedValue(undefined)
  const queue = { consume } as unknown as QueuePort
  return { queue, consume }
}

describe('Guardia de consumidores duplicados (e2e)', () => {
  it('deja registrar un consumidor por cola', async () => {
    const { queue, consume } = fakeQueue()
    rejectDuplicateConsumers(queue)

    await queue.consume({ name: 'a' }, async () => undefined)
    await queue.consume({ name: 'b' }, async () => undefined)

    expect(consume).toHaveBeenCalledTimes(2)
  })

  it('rechaza el segundo consumidor de la misma cola y nombra la cola', async () => {
    const { queue, consume } = fakeQueue()
    rejectDuplicateConsumers(queue)

    await queue.consume({ name: 'settlement-confirmed' }, async () => undefined)

    await expect(
      queue.consume({ name: 'settlement-confirmed' }, async () => undefined),
    ).rejects.toThrow(/"settlement-confirmed" ya tiene un consumidor/)
    expect(consume).toHaveBeenCalledTimes(1)
  })

  describe('con la app completa', () => {
    let app: INestApplication

    afterAll(async () => {
      await app?.close()
    })

    it('la app arranca (ningún módulo consume dos veces una cola) y un segundo consumo falla', async () => {
      app = await createTestApp()

      // `notifications` ya consume esta cola: el test no puede sumarse.
      await expect(
        app
          .get(QueuePort)
          .consume({ name: 'settlement-confirmed' }, async () => undefined),
      ).rejects.toThrow(/ya tiene un consumidor/)
    })
  })
})
