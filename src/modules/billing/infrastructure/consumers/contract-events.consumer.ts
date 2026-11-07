import { Injectable, OnModuleInit } from '@nestjs/common'

import { InstallmentRebaser } from '@/modules/billing/application/installment-rebaser'
import { InstallmentTerminationCloser } from '@/modules/billing/application/installment-termination-closer'
import {
  CONTRACT_RENT_UPDATED_QUEUE,
  CONTRACT_TERMINATED_BILLING_QUEUE,
  ContractRentUpdatedPayload,
  ContractTerminatedPayload,
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
    private readonly closer: InstallmentTerminationCloser,
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
    await this.queue.consume<ContractTerminatedPayload>(
      CONTRACT_TERMINATED_BILLING_QUEUE,
      async (message) => {
        await this.closer.close(
          message.payload.contractId,
          message.payload.notifiedAt,
        )
      },
    )
  }
}
