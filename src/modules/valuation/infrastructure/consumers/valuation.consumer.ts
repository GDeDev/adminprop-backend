import { Injectable, OnModuleInit } from '@nestjs/common'

import { AsyncJobsFacade } from '@/modules/jobs/public'
import { QueuePort } from '@/platform/queue/queue.port'
import { errorMessage } from '@/shared/core/error-message'
import { createLogger } from '@/shared/logging/root-logger'
import { ComparablesRefreshService } from '../../application/comparables-refresh.service'
import {
  REFRESH_ZONE_QUEUE,
  RefreshZonePayload,
} from '../../application/valuation-queues'

/** Atiende la corrida manual de una zona, dentro del tenant que la pidió. */
@Injectable()
export class ValuationConsumer implements OnModuleInit {
  private readonly logger = createLogger('ValuationConsumer')

  constructor(
    private readonly queue: QueuePort,
    private readonly refresh: ComparablesRefreshService,
    private readonly jobs: AsyncJobsFacade,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.consume<RefreshZonePayload>(
      REFRESH_ZONE_QUEUE,
      async (message) => {
        const { jobId, zoneKey } = message.payload
        await this.jobs.markProcessing(jobId)
        try {
          const summary = await this.refresh.runZone(zoneKey, new Date())
          await this.jobs.complete(jobId, summary)
        } catch (error) {
          this.logger.error(
            { err: error, zoneKey },
            'Falló la actualización de la zona',
          )
          await this.jobs.fail(jobId, errorMessage(error))
        }
      },
    )
  }
}
