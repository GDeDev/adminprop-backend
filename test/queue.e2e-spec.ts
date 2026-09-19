import { randomUUID } from 'node:crypto'

import { PgBossQueueAdapter } from '../src/platform/queue/adapters/pg-boss.queue-adapter'
import { deadLetterOf, QueueDefinition } from '../src/platform/queue/queue.port'
import { RequestContext } from '../src/shared/context/request-context'
import { TEST_DATABASE_URL } from './utils/test-database-url'
import { waitFor } from './utils/wait-for'

/**
 * pg-boss contra Postgres real: lo que se prueba es la cola de verdad
 * (persistencia, reintentos, dead-letter), no un mock de ella.
 */
describe('QueuePort con pg-boss (e2e, Postgres)', () => {
  let queue: PgBossQueueAdapter

  // Nombre único por corrida: la cola persiste entre ejecuciones.
  const unique = (name: string): QueueDefinition => ({
    name: `${name}-${randomUUID().slice(0, 8)}`,
    retryLimit: 1,
    retryDelaySeconds: 1,
    retryBackoff: false,
  })

  beforeAll(async () => {
    queue = new PgBossQueueAdapter(TEST_DATABASE_URL, {
      pollingIntervalSeconds: 0.5,
    })
    await queue.start()
  })

  afterAll(async () => {
    await queue.stop()
  })

  it('entrega el mensaje dentro del tenant en el que se publicó', async () => {
    const definition = unique('tenant-context')
    const received: { payload: unknown; tenantId?: string }[] = []

    await queue.consume<{ value: number }>(definition, async (message) => {
      received.push({
        payload: message.payload,
        tenantId: RequestContext.tenantId,
      })
    })

    await RequestContext.run({ correlationId: 'e2e' }, () =>
      RequestContext.runInTenant('tenant-a', () =>
        queue.publish(definition, { value: 42 }),
      ),
    )

    await waitFor(() => received.length === 1)
    expect(received[0]).toEqual({
      payload: { value: 42 },
      tenantId: 'tenant-a',
    })
  })

  it('reintenta un trabajo que falla y después lo manda a la dead-letter', async () => {
    const definition = unique('always-fails')
    const attempts: number[] = []
    const deadLettered: unknown[] = []

    await queue.consume(definition, async (message) => {
      attempts.push(message.retryCount)
      throw new Error('falla a propósito')
    })
    await queue.consume(
      { name: deadLetterOf(definition.name) },
      async (message) => {
        deadLettered.push(message.payload)
      },
    )

    await queue.publish(definition, { order: 'A-1' })

    await waitFor(() => deadLettered.length === 1)
    // Primer intento + 1 reintento (retryLimit: 1).
    expect(attempts).toEqual([0, 1])
    expect(deadLettered).toEqual([{ order: 'A-1' }])
  })
})
