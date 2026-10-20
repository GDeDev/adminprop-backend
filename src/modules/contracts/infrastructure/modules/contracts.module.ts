import { Module } from '@nestjs/common'

import {
  ApplyRentUpdateHandler,
  CreateContractHandler,
  RenewContractHandler,
  TerminateContractHandler,
  UpdateContractHandler,
  UploadContractDocumentHandler,
} from '@/modules/contracts/application/commands/contract.handlers'
import { ContractLifecycle } from '@/modules/contracts/application/contract-lifecycle'
import { ContractParties } from '@/modules/contracts/application/contract-parties'
import { ContractViews } from '@/modules/contracts/application/contract.views'
import {
  GetContractHandler,
  ListContractsHandler,
  PreviewTerminationHandler,
} from '@/modules/contracts/application/queries/contract.queries'
import { ContractRepository } from '@/modules/contracts/domain/contract.ports'
import { ContractsFacade } from '@/modules/contracts/public/contracts.facade'
import { IndicesModule } from '@/modules/indices/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesModule } from '@/modules/properties/public'
import { RentersModule } from '@/modules/renters/public'
import { TenantsModule } from '@/modules/tenants/public'
import { ContractsController } from '../http/controllers/contracts.controller'
import { ContractRepositoryImpl } from '../repositories/contract.repository.impl'

/**
 * Contratos (spec Fase 9, PRD 5.5). Depende de propiedades, propietarios,
 * inquilinos, inmobiliarias e índices por sus facades; ninguno de ellos
 * importa a contratos (D-51).
 */
@Module({
  imports: [
    PropertiesModule,
    OwnersModule,
    RentersModule,
    TenantsModule,
    IndicesModule,
  ],
  controllers: [ContractsController],
  providers: [
    { provide: ContractRepository, useClass: ContractRepositoryImpl },
    ContractViews,
    ContractParties,
    ContractLifecycle,
    ContractsFacade,
    CreateContractHandler,
    UpdateContractHandler,
    UploadContractDocumentHandler,
    ApplyRentUpdateHandler,
    TerminateContractHandler,
    RenewContractHandler,
    ListContractsHandler,
    GetContractHandler,
    PreviewTerminationHandler,
  ],
  exports: [ContractsFacade],
})
export class ContractsModule {}
