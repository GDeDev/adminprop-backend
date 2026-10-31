import { Injectable, OnModuleInit } from '@nestjs/common'

import { InstallmentRebaser } from '@/modules/billing/application/installment-rebaser'
import {
  CONTRACT_RENT_UPDATED_QUEUE,
  ContractRentUpdatedPayload,
} from '@/modules/contracts/public'
import { QueuePort } from '@/platform/queue/queue.port'
import { createLogger } from '@/shared/logging/root-logger'

/**
 * Se suscribe a los eventos de contratos. Con cada aumento aplicado corrige
 * la base de las cuotas ya generadas (Fase 13, 2.1); el handler corre dentro
 * del tenant del mensaje y se reintenta si falla.
 */
@Injectable()
export class ContractEventsConsumer implements OnModuleInit {
  private readonly logger = createLogger('ContractEventsConsumer')

  constructor(
    private readonly queue: QueuePort,
    private readonly rebaser: InstallmentRebaser,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.consume<ContractRentUpdatedPayload>(
      CONTRACT_RENT_UPDATED_QUEUE,
      async (message) => {
        const result = await this.rebaser.handle(message.payload)
        this.logger.info(
          {
            contractId: result.contractId,
            rebased: result.rebased.length,
            outdated: result.outdated.length,
          },
          'Base de cuotas corregida por un aumento',
        )
      },
    )
  }
}
