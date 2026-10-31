import { Injectable, OnModuleInit } from '@nestjs/common'

import { QueuePort } from '@/platform/queue/queue.port'
import { JobMessage } from '../../application/job.types'
import { JobRunner } from '../../application/job-runner'
import { queueOf } from '../../application/automation-queues'
import { JOB_CATALOG } from '../../domain/job-catalog'

/**
 * Se suscribe a la cola de cada job. El handler corre dentro del tenant del
 * mensaje (los jobs globales, sin tenant) y, si tira, pg-boss reintenta hasta
 * 3 veces más, cada 60 segundos. Siempre consume, aunque el disparo
 * automático esté apagado: las corridas manuales dependen de esto.
 */
@Injectable()
export class JobsConsumer implements OnModuleInit {
  constructor(
    private readonly queue: QueuePort,
    private readonly runner: JobRunner,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const definition of JOB_CATALOG) {
      await this.queue.consume<JobMessage>(
        queueOf(definition.name),
        async (message) => {
          await this.runner.execute(
            message.payload,
            message.tenantId,
            message.retryCount,
          )
        },
      )
    }
  }
}
