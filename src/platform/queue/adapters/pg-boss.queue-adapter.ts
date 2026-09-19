import PgBoss from 'pg-boss'

import { createLogger } from '@/shared/logging/root-logger'
import { dispatch, QueueEnvelope, wrap } from '../queue-envelope'
import {
  deadLetterOf,
  PublishOptions,
  QUEUE_DEFAULTS,
  QueueDefinition,
  QueueHandler,
  QueuePort,
} from '../queue.port'

/** Schema propio para las tablas de pg-boss: no se mezcla con las de Prisma. */
export const PG_BOSS_SCHEMA = 'pgboss'

/**
 * `QueuePort` sobre pg-boss: una cola real, persistida en el mismo Postgres,
 * con reintentos y dead-letter nativos. Sobrevive a un reinicio del proceso y,
 * con varias instancias, cada trabajo lo toma una sola.
 *
 * pg-boss crea y migra su propio schema (`pgboss`) al arrancar; Prisma sólo
 * maneja `public`, así que no se pisan.
 */
export class PgBossQueueAdapter extends QueuePort {
  private readonly logger = createLogger('PgBossQueue')
  private readonly boss: PgBoss
  private readonly declared = new Map<string, Promise<void>>()
  private started?: Promise<void>

  constructor(
    connectionString: string,
    private readonly options: { pollingIntervalSeconds?: number } = {},
  ) {
    super()
    this.boss = new PgBoss({ connectionString, schema: PG_BOSS_SCHEMA })
    // Sin listener, un error de conexión de pg-boss tumba el proceso.
    this.boss.on('error', (error) =>
      this.logger.error({ err: error }, 'Error de pg-boss'),
    )
  }

  /** Arranca una sola vez, la primera vez que alguien usa la cola. */
  start(): Promise<void> {
    this.started ??= this.boss.start().then(() => {
      this.logger.info('Cola pg-boss iniciada')
    })
    return this.started
  }

  async stop(): Promise<void> {
    if (!this.started) return
    await this.boss.stop({ graceful: true, wait: true, timeout: 10_000 })
    this.started = undefined
  }

  declare(definition: QueueDefinition): Promise<void> {
    let pending = this.declared.get(definition.name)
    if (!pending) {
      pending = this.createQueues(definition)
      this.declared.set(definition.name, pending)
    }
    return pending
  }

  async publish<T extends object>(
    definition: QueueDefinition,
    payload: T,
    options: PublishOptions = {},
  ): Promise<string> {
    await this.declare(definition)

    const id = await this.boss.send(definition.name, wrap(payload), {
      singletonKey: options.singletonKey,
      startAfter: options.startAfterSeconds,
    })

    if (!id) {
      // pg-boss devuelve null cuando el singletonKey ya tiene un trabajo vivo.
      throw new DuplicateJobError(definition.name, options.singletonKey)
    }

    return id
  }

  async consume<T extends object>(
    definition: QueueDefinition,
    handler: QueueHandler<T>,
  ): Promise<void> {
    await this.declare(definition)

    await this.boss.work<QueueEnvelope<T>>(
      definition.name,
      {
        batchSize: 1,
        includeMetadata: true,
        pollingIntervalSeconds: this.options.pollingIntervalSeconds ?? 2,
      },
      async ([job]) => {
        // Tirar acá marca el trabajo como fallido: pg-boss lo reintenta y,
        // agotados los reintentos, lo mueve a la dead-letter.
        await dispatch(job.id, job.data, job.retryCount, handler)
      },
    )
  }

  private async createQueues(definition: QueueDefinition): Promise<void> {
    await this.start()

    const deadLetter = deadLetterOf(definition.name)
    // La dead-letter tiene que existir antes que la cola que la referencia.
    await this.boss.createQueue(deadLetter, { name: deadLetter })
    await this.boss.createQueue(definition.name, {
      name: definition.name,
      retryLimit: definition.retryLimit ?? QUEUE_DEFAULTS.retryLimit,
      retryDelay:
        definition.retryDelaySeconds ?? QUEUE_DEFAULTS.retryDelaySeconds,
      retryBackoff: definition.retryBackoff ?? QUEUE_DEFAULTS.retryBackoff,
      deadLetter,
    })
  }
}

/** Ya hay un trabajo vivo con el mismo `singletonKey`. */
export class DuplicateJobError extends Error {
  constructor(queue: string, singletonKey?: string) {
    super(
      `Ya hay un trabajo pendiente en "${queue}" con la clave "${singletonKey}"`,
    )
    this.name = 'DuplicateJobError'
  }
}
