import { INestApplication } from '@nestjs/common'

import { QueuePort } from '../src/platform/queue/queue.port'
import { createTestApp } from './utils/app'
import { waitFor } from './utils/wait-for'

describe('waitFor (e2e, Postgres)', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app?.close()
  })

  it('devuelve apenas la condición se cumple', async () => {
    let calls = 0
    await waitFor(() => ++calls >= 3, { intervalMs: 5 })
    expect(calls).toBe(3)
  })

  it('al agotarse, el error dice qué se esperaba', async () => {
    await expect(
      waitFor(() => false, { timeoutMs: 50, what: 'evento X de la cola' }),
    ).rejects.toThrow(/"evento X de la cola" no se cumplió en 50ms/)
  })

  it('al agotarse, vuelca el estado de pgboss.job', async () => {
    // Un mensaje sin consumidor queda en `created` y debe verse en el volcado.
    const queue = app.get(QueuePort)
    await queue.publish({ name: 'waitfor-sin-consumidor' }, { n: 1 })

    const failure = await waitFor(() => false, { timeoutMs: 50 }).catch(
      (error: Error) => error.message,
    )

    expect(failure).toContain('Estado de pgboss.job:')
    expect(failure).toContain('waitfor-sin-consumidor [created]: 1')
  })
})
