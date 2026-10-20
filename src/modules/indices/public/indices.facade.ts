import { Injectable } from '@nestjs/common'

import { IndexType } from '../domain/index-value'
import { IndexValueRepository } from '../domain/index-value.ports'

/**
 * Lo que otros módulos pueden preguntarle a índices: el valor de un mes.
 * Contratos lo usa al aplicar un aumento ICL/IPC.
 */
@Injectable()
export class IndicesFacade {
  constructor(private readonly indices: IndexValueRepository) {}

  /** Valor como string decimal, o `null` si ese mes no está cargado. */
  async getValue(indexType: IndexType, period: string): Promise<string | null> {
    const value = await this.indices.find(indexType, period)
    return value?.value ?? null
  }
}
