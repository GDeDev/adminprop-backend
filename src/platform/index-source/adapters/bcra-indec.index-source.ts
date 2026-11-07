import {
  IndexSourcePort,
  IndexSourceResult,
  SourceIndexType,
} from '../index-source.port'
import { BcraIclAdapter } from './bcra-icl.adapter'
import { IndecIpcAdapter } from './indec-ipc.adapter'

/** ICL del BCRA + IPC del INDEC (`INDEX_SOURCE_PROVIDER=bcra-indec`, el default). */
export class BcraIndecIndexSource extends IndexSourcePort {
  readonly provider = 'bcra-indec'

  constructor(
    private readonly icl: BcraIclAdapter = new BcraIclAdapter(),
    private readonly ipc: IndecIpcAdapter = new IndecIpcAdapter(),
  ) {
    super()
  }

  supports(): boolean {
    return true
  }

  fetch(
    indexType: SourceIndexType,
    periods: string[],
  ): Promise<IndexSourceResult> {
    return indexType === 'ICL'
      ? this.icl.fetch(periods)
      : this.ipc.fetch(periods)
  }
}
