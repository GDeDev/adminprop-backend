import { Injectable } from '@nestjs/common'

import {
  ExampleItemCreatedPayload,
  ExampleItemsFacade,
} from '@/modules/_example/public'
import { ExampleActivityRepository } from '@/modules/_example-listener/domain/example-activity.repository'

/**
 * Reacción de este módulo a un alta en `_example`.
 *
 * Demuestra las dos formas permitidas de comunicarse con otro módulo (spec
 * Fase 1, 5.1): el **evento** trae el payload, y la **facade** pública responde
 * una consulta sincrónica. Nunca el repositorio ni las tablas de `_example`
 * (el linter de boundaries rechaza ese import).
 */
@Injectable()
export class RecordExampleCreatedService {
  constructor(
    private readonly activity: ExampleActivityRepository,
    private readonly examples: ExampleItemsFacade,
  ) {}

  async handle(payload: ExampleItemCreatedPayload): Promise<void> {
    // Por si el ítem se borró entre que se publicó el evento y ahora.
    const current = await this.examples.getBasicInfo(payload.exampleItemId)
    const name = current?.name ?? payload.name

    await this.activity.record(
      payload.exampleItemId,
      `Se creó "${name}" con precio ${payload.price}`,
    )
  }
}
