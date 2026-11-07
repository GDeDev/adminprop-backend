import { Injectable } from '@nestjs/common'

import { StoragePort } from '@/platform/storage/storage.port'
import { createLogger } from '@/shared/logging/root-logger'
import { ImportBatchRepository } from '../domain/migration.ports'
import { ImportBatch, ImportBatchStatus } from '../domain/migration.types'

/** Días que un lote puede esperar su revisión antes de descartarse solo (A-79). */
export const STALE_BATCH_DAYS = 7

/**
 * Descarta un lote pendiente de revisión: el cambio de estado es atómico y el
 * archivo subido se borra del storage. Lo usan el endpoint de descarte y la
 * limpieza de lotes vencidos.
 */
@Injectable()
export class BatchDiscarder {
  private readonly logger = createLogger('BatchDiscarder')

  constructor(
    private readonly batches: ImportBatchRepository,
    private readonly storage: StoragePort,
  ) {}

  /** Devuelve si lo descartó (false si ya no estaba en `READY`). */
  async discard(batch: ImportBatch): Promise<boolean> {
    const moved = await this.batches.transition(
      batch.id,
      ImportBatchStatus.READY,
      { status: ImportBatchStatus.DISCARDED },
    )
    if (moved && batch.fileKey) {
      try {
        await this.storage.delete(batch.fileKey)
        // Sólo si se borró: con la clave en null, un archivo que quedó en el
        // storage ya no tendría quién lo encuentre.
        await this.batches.update(batch.id, { fileKey: null })
      } catch (error) {
        this.logger.warn(
          { err: error },
          'No se pudo borrar el archivo del lote',
        )
      }
    }
    return moved
  }

  /** Descarta los lotes que llevan más de `STALE_BATCH_DAYS` sin confirmarse. */
  async discardStale(now: Date = new Date()): Promise<number> {
    const before = new Date(now.getTime() - STALE_BATCH_DAYS * 86_400_000)
    let discarded = 0
    for (const batch of await this.batches.listStaleReady(before)) {
      if (await this.discard(batch)) discarded += 1
    }
    return discarded
  }
}
