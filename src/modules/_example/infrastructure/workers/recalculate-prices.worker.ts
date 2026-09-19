import { Injectable, OnModuleInit } from '@nestjs/common'

import {
  RECALCULATE_PRICES_QUEUE,
  RecalculatePricesJobPayload,
} from '@/modules/_example/application/recalculate-prices.contract'
import { ExampleItemPolicy } from '@/modules/_example/domain/example-item.policy'
import { ExampleItemRepository } from '@/modules/_example/domain/example-item.repository'
import { AsyncJobsFacade } from '@/modules/jobs/public'
import { QueueMessage, QueuePort } from '@/platform/queue/queue.port'
import { createLogger } from '@/shared/logging/root-logger'

/**
 * Consumidor de la cola de aumento masivo. Corre dentro del tenant del mensaje
 * (lo restaura el `QueuePort`), así que el repositorio filtra igual que en un
 * request.
 *
 * Patrón para todo trabajo pesado: `markProcessing` → un `recordItem` por
 * ítem (un ítem que falla no frena a los demás) → `complete`.
 */
@Injectable()
export class RecalculatePricesWorker implements OnModuleInit {
  private readonly logger = createLogger('RecalculatePricesWorker')

  constructor(
    private readonly queue: QueuePort,
    private readonly items: ExampleItemRepository,
    private readonly jobs: AsyncJobsFacade,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.consume<RecalculatePricesJobPayload>(
      RECALCULATE_PRICES_QUEUE,
      (message) => this.process(message),
    )
  }

  async process(
    message: QueueMessage<RecalculatePricesJobPayload>,
  ): Promise<void> {
    const { jobId, percentage, simulateTransientFailure } = message.payload

    if (simulateTransientFailure && message.retryCount === 0) {
      // Falla antes de tocar nada: la cola lo reintenta y el segundo intento
      // termina bien. Así se ve un reintento real sin romper nada.
      throw new Error('Falla transitoria simulada')
    }

    // Ojo con la idempotencia: si un intento falla a mitad de camino, el
    // reintento vuelve a recorrer todo. Acá no pasa porque sólo falla antes
    // de empezar; un trabajo real tiene que poder repetirse sin aplicar dos
    // veces el aumento (ej. guardando qué ítems ya procesó).
    await this.jobs.markProcessing(jobId)

    for (const id of await this.items.listIds()) {
      try {
        const item = await this.items.findById(id)
        if (!item) throw new Error(`El ítem ${id} ya no existe`)
        await this.items.updatePrice(
          id,
          ExampleItemPolicy.applyIncrease(item.price, percentage),
        )
        await this.jobs.recordItem(jobId, 'succeeded')
      } catch (error) {
        this.logger.warn({ err: error, jobId, id }, 'Falló un ítem del aumento')
        await this.jobs.recordItem(jobId, 'failed')
      }
    }

    await this.jobs.complete(jobId, { percentage })
  }
}
