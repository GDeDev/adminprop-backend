import { Module } from '@nestjs/common'

import { ExampleModule } from '@/modules/_example/public'
import { RecordExampleCreatedService } from '@/modules/_example-listener/application/record-example-created.service'
import { ExampleActivityRepository } from '@/modules/_example-listener/domain/example-activity.repository'
import { ExampleItemCreatedConsumer } from '../consumers/example-item-created.consumer'
import { ExampleActivityRepositoryImpl } from '../repositories/example-activity.repository.impl'

/**
 * Segundo módulo de referencia: escucha a `_example` por eventos y le consulta
 * por su facade. Importa `ExampleModule` desde `public/` sólo para poder
 * inyectar `ExampleItemsFacade`.
 */
@Module({
  imports: [ExampleModule],
  providers: [
    {
      provide: ExampleActivityRepository,
      useClass: ExampleActivityRepositoryImpl,
    },
    RecordExampleCreatedService,
    ExampleItemCreatedConsumer,
  ],
})
export class ExampleListenerModule {}
