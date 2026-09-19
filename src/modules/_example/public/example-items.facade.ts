import { Injectable } from '@nestjs/common'

import { ExampleItemRepository } from '../domain/example-item.repository'

export interface ExampleItemBasicInfo {
  id: string
  name: string
}

/**
 * Único punto de entrada sincrónico a `_example` desde otros módulos (spec
 * Fase 1, 5.1, punto 2). Expone lo mínimo que otros necesitan, nunca la
 * entidad ni el repositorio. El día que `_example` sea otro servicio, esta
 * clase pasa a ser un cliente HTTP con la misma firma.
 */
@Injectable()
export class ExampleItemsFacade {
  constructor(private readonly items: ExampleItemRepository) {}

  async getBasicInfo(id: string): Promise<ExampleItemBasicInfo | null> {
    const item = await this.items.findById(id)
    return item ? { id: item.id, name: item.name } : null
  }
}
