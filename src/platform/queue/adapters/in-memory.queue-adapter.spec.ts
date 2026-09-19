import { RequestContext } from '@/shared/context/request-context'
import { deadLetterOf, QueueDefinition } from '../queue.port'
import { InMemoryQueueAdapter } from './in-memory.queue-adapter'

const QUEUE: QueueDefinition = { name: 'test-queue', retryLimit: 2 }

describe('InMemoryQueueAdapter', () => {
  let queue: InMemoryQueueAdapter

  beforeEach(() => {
    queue = new InMemoryQueueAdapter()
  })

  it('el consumidor corre dentro del tenant en el que se publicó', async () => {
    // Es lo que permite que un worker use los repositorios con el filtro de
    // tenant sin pasar el tenant a mano.
    let seen: string | undefined
    await queue.consume(QUEUE, async () => {
      seen = RequestContext.tenantId
    })

    await RequestContext.run({ correlationId: 'req-1' }, () =>
      RequestContext.runInTenant('tenant-a', () =>
        queue.publish(QUEUE, { any: 1 }),
      ),
    )
    await queue.drain()

    expect(seen).toBe('tenant-a')
  })

  it('propaga el correlationId del request que publicó', async () => {
    let seen: string | undefined
    await queue.consume(QUEUE, async (message) => {
      seen = message.correlationId
    })

    await RequestContext.run({ correlationId: 'req-42' }, () =>
      queue.publish(QUEUE, {}),
    )
    await queue.drain()

    expect(seen).toBe('req-42')
  })

  it('reintenta y, agotados los reintentos, manda el mensaje a la dead-letter', async () => {
    const attempts: number[] = []
    await queue.consume<{ n: number }>(QUEUE, async (message) => {
      attempts.push(message.retryCount)
      throw new Error('falla siempre')
    })

    await queue.publish(QUEUE, { n: 7 })
    await queue.drain()

    // Primer intento + retryLimit (2) reintentos.
    expect(attempts).toEqual([0, 1, 2])
    expect(queue.deadLetters.get(deadLetterOf(QUEUE.name))).toEqual([{ n: 7 }])
  })

  it('un fallo transitorio se recupera en el reintento', async () => {
    let calls = 0
    await queue.consume(QUEUE, async () => {
      calls++
      if (calls === 1) throw new Error('falla una vez')
    })

    await queue.publish(QUEUE, {})
    await queue.drain()

    expect(calls).toBe(2)
    expect(queue.deadLetters.size).toBe(0)
  })

  it('lo publicado antes de registrar el consumidor se procesa igual', async () => {
    const received: unknown[] = []
    await queue.publish(QUEUE, { early: true })

    await queue.consume(QUEUE, async (message) => {
      received.push(message.payload)
    })
    await queue.drain()

    expect(received).toEqual([{ early: true }])
  })
})
