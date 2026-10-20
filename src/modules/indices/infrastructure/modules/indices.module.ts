import { Module } from '@nestjs/common'

import { RegisterIndexValueHandler } from '@/modules/indices/application/commands/register-index-value.handler'
import { ListIndexValuesHandler } from '@/modules/indices/application/queries/list-index-values.query'
import { IndexValueRepository } from '@/modules/indices/domain/index-value.ports'
import { IndicesFacade } from '@/modules/indices/public/indices.facade'
import { IndicesController } from '../http/controllers/indices.controller'
import { IndexValueRepositoryImpl } from '../repositories/index-value.repository.impl'

/**
 * Índices ICL/IPC (spec Fase 9, 3.8; Fase 13, 3). Módulo chico y aparte de
 * contratos: la Fase 13 le suma el job que los trae de la fuente oficial sin
 * tocar contratos.
 */
@Module({
  controllers: [IndicesController],
  providers: [
    { provide: IndexValueRepository, useClass: IndexValueRepositoryImpl },
    IndicesFacade,
    RegisterIndexValueHandler,
    ListIndexValuesHandler,
  ],
  exports: [IndicesFacade],
})
export class IndicesModule {}
