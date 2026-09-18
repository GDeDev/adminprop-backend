import { Global, Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { CqrsModule } from '@nestjs/cqrs'

import { InfraModule } from './infra/infra.module'
import { PaginationService } from './services/pagination.service'

@Global()
@Module({
  imports: [
    CqrsModule,
    HttpModule.register({
      // Sin timeout, una API externa colgada te consume el pool de conexiones.
      timeout: 10_000,
      maxRedirects: 3,
    }),
    InfraModule,
  ],
  providers: [PaginationService],
  exports: [CqrsModule, HttpModule, PaginationService, InfraModule],
})
export class SharedModule {}
