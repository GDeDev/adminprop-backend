import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { ExampleItemPolicy } from '@/modules/_example/domain/example-item.policy'
import { ExampleItemRepository } from '@/modules/_example/domain/example-item.repository'
import { AsyncJobsFacade } from '@/modules/jobs/public'
import { FeatureFlagPort } from '@/platform/feature-flags/feature-flag.port'
import { QueuePort } from '@/platform/queue/queue.port'
import { AppException, ErrorCode } from '@/shared/errors'
import {
  EXAMPLE_BULK_RECALCULATE_FLAG,
  RECALCULATE_PRICES_QUEUE,
  RecalculatePricesJobPayload,
} from '../../recalculate-prices.contract'
import { RecalculateExamplePricesCommand } from './recalculate-example-prices.command'

/**
 * Acción pesada: aumentar el precio de todos los ítems.
 *
 * Nunca corre dentro del request (spec Fase 1, 5.2 y 9.1): el handler valida,
 * crea el `AsyncJob`, encola y devuelve el id para el `202`. El trabajo lo
 * hace `RecalculatePricesWorker`.
 *
 * El feature flag se consulta acá, en el handler, y no en el Domain Service:
 * el flag decide si se invoca la regla, no cómo se comporta.
 */
@CommandHandler(RecalculateExamplePricesCommand)
export class RecalculateExamplePricesHandler implements ICommandHandler<
  RecalculateExamplePricesCommand,
  { jobId: string }
> {
  constructor(
    private readonly items: ExampleItemRepository,
    private readonly jobs: AsyncJobsFacade,
    private readonly queue: QueuePort,
    private readonly flags: FeatureFlagPort,
  ) {}

  async execute(
    command: RecalculateExamplePricesCommand,
  ): Promise<{ jobId: string }> {
    if (!(await this.flags.isEnabled(EXAMPLE_BULK_RECALCULATE_FLAG))) {
      throw AppException.forbidden(
        'Esta funcionalidad no está habilitada para tu inmobiliaria',
        ErrorCode.FEATURE_DISABLED,
      )
    }

    // Validar antes de encolar: un porcentaje inválido es un 422 inmediato,
    // no un trabajo que falla en background.
    ExampleItemPolicy.assertValidIncrease(command.percentage)

    const jobId = await this.jobs.start('example-recalculate-prices', {
      totalItems: await this.items.count(),
    })

    const payload: RecalculatePricesJobPayload = {
      jobId,
      percentage: command.percentage,
      simulateTransientFailure: command.simulateTransientFailure,
    }
    await this.queue.publish(RECALCULATE_PRICES_QUEUE, payload)

    return { jobId }
  }
}
