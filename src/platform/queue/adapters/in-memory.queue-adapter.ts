import { randomUUID } from 'node:crypto'

import { dispatch, QueueEnvelope, wrap } from '../queue-envelope'
import {
  deadLetterOf,
  PublishOptions,
  QUEUE_DEFAULTS,
  QueueDefinition,
  QueueHandler,
  QueuePort,
} from '../queue.port'

interface StoredJob {
  id: string
  queue: string
  envelope: QueueEnvelope<unknown>
}

/**
 * `QueuePort` en memoria, para tests unitarios (`QUEUE_PROVIDER=memory`).
 *
 * Respeta el mismo contrato que pg-boss —contexto de tenant restaurado,
 * reintentos, dead-letter— pero sin esperas entre intentos ni persistencia.
 * No sirve para producción: un reinicio pierde todo lo pendiente.
 */
export class InMemoryQueueAdapter extends QueuePort {
  private readonly handlers = new Map<string, QueueHandler<any>>()
  private readonly definitions = new Map<string, QueueDefinition>()
  private readonly pending: StoredJob[] = []
  /** Trabajos que agotaron los reintentos, por cola de origen. */
  readonly deadLetters = new Map<string, unknown[]>()
  private running = Promise.resolve()

  async declare(definition: QueueDefinition): Promise<void> {
    this.definitions.set(definition.name, definition)
  }

  async publish<T extends object>(
    definition: QueueDefinition,
    payload: T,
    _options?: PublishOptions,
  ): Promise<string> {
    await this.declare(definition)
    const job: StoredJob = {
      id: randomUUID(),
      queue: definition.name,
      envelope: wrap(payload),
    }
    this.pending.push(job)
    this.schedule()
    return job.id
  }

  async consume<T extends object>(
    definition: QueueDefinition,
    handler: QueueHandler<T>,
  ): Promise<void> {
    await this.declare(definition)
    this.handlers.set(definition.name, handler)
    this.schedule()
  }

  /** Espera a que se procese todo lo encolado. Para los tests. */
  async drain(): Promise<void> {
    await this.running
  }

  private schedule(): void {
    // Encadena el procesamiento fuera del call stack del publish, como haría
    // una cola real: quien publica nunca espera al consumidor.
    this.running = this.running
      .then(() => new Promise(setImmediate))
      .then(() => this.processPending())
  }

  private async processPending(): Promise<void> {
    for (let i = 0; i < this.pending.length;) {
      const job = this.pending[i]
      const handler = this.handlers.get(job.queue)
      if (!handler) {
        i++
        continue
      }
      this.pending.splice(i, 1)
      await this.run(job, handler)
    }
  }

  private async run(job: StoredJob, handler: QueueHandler<unknown>) {
    const definition = this.definitions.get(job.queue)
    const retryLimit = definition?.retryLimit ?? QUEUE_DEFAULTS.retryLimit

    for (let retryCount = 0; retryCount <= retryLimit; retryCount++) {
      try {
        await dispatch(job.id, job.envelope, retryCount, handler)
        return
      } catch {
        // Se reintenta; agotados los intentos va a la dead-letter.
      }
    }

    const deadLetter = deadLetterOf(job.queue)
    const list = this.deadLetters.get(deadLetter) ?? []
    list.push(job.envelope.payload)
    this.deadLetters.set(deadLetter, list)
  }
}
