import { IndexSourcePort, IndexSourceResult } from '../index-source.port'

/**
 * No busca nada (`INDEX_SOURCE_PROVIDER=manual`): el job `indices.fetch`
 * termina `SKIPPED` y los valores se cargan a mano con `POST /indices`.
 */
export class ManualIndexSource extends IndexSourcePort {
  readonly provider = 'manual'

  supports(): boolean {
    return false
  }

  async fetch(): Promise<IndexSourceResult> {
    return { source: 'manual', values: [] }
  }
}
