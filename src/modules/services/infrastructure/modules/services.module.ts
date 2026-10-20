import { Module } from '@nestjs/common'

import { ContractsModule } from '@/modules/contracts/public'
import { MasterDataModule } from '@/modules/master-data/public'
import { PropertiesModule } from '@/modules/properties/public'
import {
  CreateServiceHandler,
  DeleteServiceHandler,
  UpdateServiceHandler,
} from '@/modules/services/application/commands/service.handlers'
import {
  ListContractServicesHandler,
  ListOverdueServicesHandler,
  ListPropertyServicesHandler,
} from '@/modules/services/application/queries/service.queries'
import { ServiceReferences } from '@/modules/services/application/service-references'
import { ServiceViews } from '@/modules/services/application/service.views'
import { PropertyServiceRepository } from '@/modules/services/domain/service.ports'
import { ServicesFacade } from '@/modules/services/public/services.facade'
import { ServicesController } from '../http/controllers/services.controller'
import { PropertyServiceRepositoryImpl } from '../repositories/property-service.repository.impl'

/**
 * Servicios (spec Fase 10, PRD 5.6). Depende de propiedades, contratos y
 * maestros por sus facades; ninguno de ellos importa a servicios (D-68).
 */
@Module({
  imports: [PropertiesModule, ContractsModule, MasterDataModule],
  controllers: [ServicesController],
  providers: [
    {
      provide: PropertyServiceRepository,
      useClass: PropertyServiceRepositoryImpl,
    },
    ServiceReferences,
    ServiceViews,
    ServicesFacade,
    CreateServiceHandler,
    UpdateServiceHandler,
    DeleteServiceHandler,
    ListPropertyServicesHandler,
    ListContractServicesHandler,
    ListOverdueServicesHandler,
  ],
  exports: [ServicesFacade],
})
export class ServicesModule {}
