import { Injectable } from '@nestjs/common'

import { BatchDiscarder } from '../application/batch-discarder'

/**
 * Lo que otros módulos pueden pedirle a la migración: la limpieza de lotes
 * que esperan su revisión hace más de 7 días (A-79). La llama el job
 * `migration.discard-stale-batches` de automatizaciones, por inmobiliaria.
 */
@Injectable()
export class MigrationFacade {
  constructor(private readonly discarder: BatchDiscarder) {}

  /** Descarta los lotes `READY` vencidos y borra sus archivos. */
  discardStaleBatches(now?: Date): Promise<number> {
    return this.discarder.discardStale(now)
  }
}
