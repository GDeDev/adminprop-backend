import { Module } from '@nestjs/common'

import {
  CreateGuarantorHandler,
  DeleteGuarantorHandler,
  UpdateGuarantorHandler,
} from '@/modules/renters/application/commands/guarantor.handlers'
import {
  CreateRenterHandler,
  DeleteRenterHandler,
  IssueRenterPortalCredentialsHandler,
  UpdateRenterHandler,
} from '@/modules/renters/application/commands/renter.handlers'
import {
  CheckGuarantorDataHandler,
  GetGuarantorHandler,
  ListGuarantorsHandler,
} from '@/modules/renters/application/queries/guarantor.queries'
import {
  CheckRenterDataHandler,
  GetRenterHandler,
  ListRentersHandler,
} from '@/modules/renters/application/queries/renter.queries'
import { RenterViews } from '@/modules/renters/application/renter.views'
import { GuarantorRepository } from '@/modules/renters/domain/guarantor.ports'
import {
  RenterContracts,
  RenterRepository,
} from '@/modules/renters/domain/renter.ports'
import { RentersFacade } from '@/modules/renters/public/renters.facade'
import { GuarantorsController } from '../http/controllers/guarantors.controller'
import { RentersController } from '../http/controllers/renters.controller'
import { GuarantorRepositoryImpl } from '../repositories/guarantor.repository.impl'
import { NoContractsYet } from '../repositories/no-contracts-yet'
import { RenterRepositoryImpl } from '../repositories/renter.repository.impl'

/**
 * Inquilinos y garantes (spec Fase 8, PRD 5.3 y 5.4). Un solo módulo: un
 * garante no existe sin inquilinos, así que las dos tablas (y la FK entre
 * ellas) viven acá.
 */
@Module({
  controllers: [RentersController, GuarantorsController],
  providers: [
    { provide: RenterRepository, useClass: RenterRepositoryImpl },
    { provide: GuarantorRepository, useClass: GuarantorRepositoryImpl },
    // Fase 9: reemplazar por la implementación que consulta contratos.
    { provide: RenterContracts, useClass: NoContractsYet },
    RenterViews,
    RentersFacade,
    CreateRenterHandler,
    UpdateRenterHandler,
    IssueRenterPortalCredentialsHandler,
    DeleteRenterHandler,
    ListRentersHandler,
    GetRenterHandler,
    CheckRenterDataHandler,
    CreateGuarantorHandler,
    UpdateGuarantorHandler,
    DeleteGuarantorHandler,
    ListGuarantorsHandler,
    GetGuarantorHandler,
    CheckGuarantorDataHandler,
  ],
  exports: [RentersFacade],
})
export class RentersModule {}
