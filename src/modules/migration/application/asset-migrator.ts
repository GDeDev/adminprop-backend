import { Injectable } from '@nestjs/common'

import { AsyncJobsFacade } from '@/modules/jobs/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { ImageDownloaderPort } from '@/platform/tokko/image-downloader.port'
import { createLogger } from '@/shared/logging/root-logger'
import {
  ImportAssetRepository,
  ImportBatchRepository,
} from '../domain/migration.ports'
import {
  ImportAssetResult,
  ImportAssetStatus,
  ImportBatchStatus,
} from '../domain/migration.types'
import { MigrationJobPayload } from './migration-queues'
import { userMessage } from './user-message'

/** Propiedades que se migran a la vez (rediseño 4.4). */
const CONCURRENCY = 3

/**
 * Trae las fotos de Tokko al storage propio. Una foto que falla queda
 * `FAILED` con su motivo y no revierte la propiedad ni frena a las demás;
 * `POST /migration/batches/:id/assets/retry` reintenta sólo esas. Las URLs
 * externas nunca se guardan como foto (spec 7).
 */
@Injectable()
export class AssetMigrator {
  private readonly logger = createLogger('AssetMigrator')

  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly assets: ImportAssetRepository,
    private readonly downloader: ImageDownloaderPort,
    private readonly properties: PropertiesFacade,
    private readonly jobs: AsyncJobsFacade,
  ) {}

  async run({ batchId, jobId }: MigrationJobPayload): Promise<void> {
    await this.jobs.markProcessing(jobId)
    try {
      const pending = await this.assets.list(batchId, ImportAssetStatus.PENDING)
      // Las fotos de una propiedad van en orden (la primera es la principal);
      // propiedades distintas, en paralelo.
      const byProperty = new Map<string, ImportAssetResult[]>()
      for (const asset of pending) {
        byProperty.set(asset.propertyId, [
          ...(byProperty.get(asset.propertyId) ?? []),
          asset,
        ])
      }
      const queue = [...byProperty.values()]
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        for (let group = queue.shift(); group; group = queue.shift()) {
          for (const asset of group) await this.migrate(asset, jobId)
        }
      })
      await Promise.all(workers)
      await this.jobs.complete(jobId, { batchId })
    } catch (error) {
      this.logger.error({ err: error, batchId }, 'Falló la migración de fotos')
      await this.jobs.fail(jobId, userMessage(error).message)
    } finally {
      await this.settle(batchId)
    }
  }

  /** Terminadas las fotos, el lote vuelve a su estado final (completo o parcial). */
  private async settle(batchId: string): Promise<void> {
    const batch = await this.batches.findById(batchId)
    if (!batch || batch.status !== ImportBatchStatus.IMPORTING) return
    await this.batches.update(batchId, {
      status: batch.summary?.finalStatus ?? ImportBatchStatus.COMPLETED,
    })
  }

  private async migrate(
    asset: ImportAssetResult,
    jobId: string,
  ): Promise<void> {
    try {
      const image = await this.downloader.download(asset.sourceUrl)
      await this.properties.addPhotoFromImport(asset.propertyId, image)
      await this.assets.update(asset.id, { status: ImportAssetStatus.MIGRATED })
      await this.jobs.recordItem(jobId, 'succeeded')
    } catch (error) {
      const { message } = userMessage(error)
      await this.assets.update(asset.id, {
        status: ImportAssetStatus.FAILED,
        error: message,
      })
      await this.jobs.recordItem(jobId, 'failed')
    }
  }
}
