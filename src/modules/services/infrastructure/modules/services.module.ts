import { Module } from '@nestjs/common'

import { ContractsModule } from '@/modules/contracts/public'
import { MasterDataModule } from '@/modules/master-data/public'
import { PropertiesModule } from '@/modules/properties/public'
import { AdvanceExpenseViews } from '@/modules/services/application/advance-expense.views'
import {
  CreateAdvanceExpenseHandler,
  DeleteAdvanceExpenseHandler,
  UpdateAdvanceExpenseHandler,
} from '@/modules/services/application/commands/advance-expense.handlers'
import {
  CreateServiceHandler,
  DeleteServiceHandler,
  UpdateServiceHandler,
} from '@/modules/services/application/commands/service.handlers'
import { ListAdvanceExpensesHandler } from '@/modules/services/application/queries/advance-expense.queries'
import {
  ListContractServicesHandler,
  ListOverdueServicesHandler,
  ListPropertyServicesHandler,
} from '@/modules/services/application/queries/service.queries'
import { ServiceReferences } from '@/modules/services/application/service-references'
import { ServiceViews } from '@/modules/services/application/service.views'
import {
  AdvanceExpenseRepository,
  PropertyServiceRepository,
} from '@/modules/services/domain/service.ports'
import { ServicesFacade } from '@/modules/services/public/services.facade'
import { AdvanceExpensesController } from '../http/controllers/advance-expenses.controller'
import { ServicesController } from '../http/controllers/services.controller'
import { AdvanceExpenseRepositoryImpl } from '../repositories/advance-expense.repository.impl'
import { PropertyServiceRepositoryImpl } from '../repositories/property-service.repository.impl'

/**
 * Servicios y gastos adelantados (spec Fase 10, PRD 5.6). Depende de
 * propiedades, contratos y maestros por sus facades, y de auth (global) para
 * nombrar a quien registró un gasto; ninguno de ellos importa a servicios
 * (D-68).
 */
@Module({
  imports: [PropertiesModule, ContractsModule, MasterDataModule],
  controllers: [ServicesController, AdvanceExpensesController],
  providers: [
    {
      provide: PropertyServiceRepository,
      useClass: PropertyServiceRepositoryImpl,
    },
    {
      provide: AdvanceExpenseRepository,
      useClass: AdvanceExpenseRepositoryImpl,
    },
    ServiceReferences,
    ServiceViews,
    AdvanceExpenseViews,
    ServicesFacade,
    CreateServiceHandler,
    UpdateServiceHandler,
    DeleteServiceHandler,
    CreateAdvanceExpenseHandler,
    UpdateAdvanceExpenseHandler,
    DeleteAdvanceExpenseHandler,
    ListPropertyServicesHandler,
    ListContractServicesHandler,
    ListOverdueServicesHandler,
    ListAdvanceExpensesHandler,
  ],
  exports: [ServicesFacade],
})
export class ServicesModule {}
