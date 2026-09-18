import { Global, Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { CqrsModule } from '@nestjs/cqrs'

import { InfraModule } from './infra/infra.module'
import { PaginationService } from './pagination/pagination.service'

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
  exports: [CqrsModule, HttpModule, InfraModule, PaginationService],
})
export class SharedModule {}
