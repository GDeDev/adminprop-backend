import { Injectable, OnModuleInit } from '@nestjs/common'

import { QueuePort } from '@/platform/queue/queue.port'
import { AnalysisRunner } from '../../application/analysis-runner'
import { AssetMigrator } from '../../application/asset-migrator'
import { ImportExecutor } from '../../application/import-executor'
import {
  MIGRATION_ANALYZE_QUEUE,
  MIGRATION_ASSETS_QUEUE,
  MIGRATION_IMPORT_QUEUE,
  MigrationJobPayload,
} from '../../application/migration-queues'

/**
 * Consume las tres colas de la migración. Cada mensaje corre dentro del
 * tenant (y con el usuario) que lo publicó, así las altas quedan auditadas a
 * nombre de quien confirmó.
 */
@Injectable()
export class MigrationConsumer implements OnModuleInit {
  constructor(
    private readonly queue: QueuePort,
    private readonly analysis: AnalysisRunner,
    private readonly executor: ImportExecutor,
    private readonly assets: AssetMigrator,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.consume<MigrationJobPayload>(
      MIGRATION_ANALYZE_QUEUE,
      (message) => this.analysis.run(message.payload),
    )
    await this.queue.consume<MigrationJobPayload>(
      MIGRATION_IMPORT_QUEUE,
      (message) => this.executor.run(message.payload),
    )
    await this.queue.consume<MigrationJobPayload>(
      MIGRATION_ASSETS_QUEUE,
      (message) => this.assets.run(message.payload),
    )
  }
}
