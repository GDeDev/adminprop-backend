import { Module } from '@nestjs/common'

import { AttachExampleFileHandler } from '@/modules/_example/application/commands/attach-example-file/attach-example-file.handler'
import { CreateExampleItemHandler } from '@/modules/_example/application/commands/create-example-item/create-example-item.handler'
import { RecalculateExamplePricesHandler } from '@/modules/_example/application/commands/recalculate-example-prices/recalculate-example-prices.handler'
import { RelayExampleItemCreatedHandler } from '@/modules/_example/application/events/relay-example-item-created.handler'
import { GetExampleItemHandler } from '@/modules/_example/application/queries/get-example-item/get-example-item.handler'
import { ExampleItemRepository } from '@/modules/_example/domain/example-item.repository'
import { ExampleItemsFacade } from '@/modules/_example/public/example-items.facade'
import { JobsModule } from '@/modules/jobs/public'
import { ExampleItemsController } from '../http/controllers/example-items.controller'
import { ExampleItemRepositoryImpl } from '../repositories/example-item.repository.impl'
import { RecalculatePricesWorker } from '../workers/recalculate-prices.worker'

/**
 * Módulo de referencia (spec Fase 1). **No se borra**: es el patrón que copian
 * las fases siguientes. Ver `docs/tecnica/fase-01.md`.
 *
 * Otro módulo que necesite algo de acá importa este módulo desde `public/` y
 * usa `ExampleItemsFacade`; nunca el repositorio ni los handlers.
 */
@Module({
  imports: [JobsModule],
  controllers: [ExampleItemsController],
  providers: [
    { provide: ExampleItemRepository, useClass: ExampleItemRepositoryImpl },
    CreateExampleItemHandler,
    AttachExampleFileHandler,
    RecalculateExamplePricesHandler,
    GetExampleItemHandler,
    RelayExampleItemCreatedHandler,
    RecalculatePricesWorker,
    ExampleItemsFacade,
  ],
  exports: [ExampleItemsFacade],
})
export class ExampleModule {}
