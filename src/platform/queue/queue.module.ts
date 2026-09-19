import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Configuration } from '@/shared/config/configuration'
import { QueueProvider } from '@/shared/config/env.validation'
import { InMemoryQueueAdapter } from './adapters/in-memory.queue-adapter'
import { PgBossQueueAdapter } from './adapters/pg-boss.queue-adapter'
import { QueuePort } from './queue.port'

/**
 * Registra el `QueuePort` según `QUEUE_PROVIDER` (default: pg-boss).
 *
 * Global porque la cola es infraestructura compartida: cualquier módulo puede
 * inyectar `QueuePort` sin importar este módulo.
 */
@Global()
@Module({
  providers: [
    {
      provide: QueuePort,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Configuration, true>): QueuePort => {
        const queue = config.get('queue', { infer: true })
        if (queue.provider === QueueProvider.Memory) {
          return new InMemoryQueueAdapter()
        }
        return new PgBossQueueAdapter(
          config.get('database', { infer: true }).url,
          { pollingIntervalSeconds: queue.pollingIntervalSeconds },
        )
      },
    },
  ],
  exports: [QueuePort],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(@Inject(QueuePort) private readonly queue: QueuePort) {}

  /** Deja terminar los trabajos en curso antes de cerrar la conexión. */
  async onApplicationShutdown(): Promise<void> {
    if (this.queue instanceof PgBossQueueAdapter) await this.queue.stop()
  }
}
