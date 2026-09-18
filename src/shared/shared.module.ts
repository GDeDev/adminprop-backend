import { Global, Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { CqrsModule } from '@nestjs/cqrs'

import { InfraModule } from './infra/infra.module'
import { GlobalExceptionFilter } from './infra/filters/global-exception.filter'
import { PrismaExceptionFilter } from './infra/filters/prisma-exception.filter'
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
  providers: [
    PaginationService,
    // Los filtros globales se registran acá y se resuelven del contenedor en
    // `configureApp()`: necesitan el logger y la config inyectados.
    GlobalExceptionFilter,
    PrismaExceptionFilter,
  ],
  exports: [
    CqrsModule,
    HttpModule,
    InfraModule,
    PaginationService,
    GlobalExceptionFilter,
    PrismaExceptionFilter,
  ],
})
export class SharedModule {}
