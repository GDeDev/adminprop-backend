import { forwardRef, Module } from '@nestjs/common'

import {
  CreateOwnerHandler,
  DeleteOwnerHandler,
  IssueOwnerPortalCredentialsHandler,
  UpdateOwnerBankAccountHandler,
  UpdateOwnerFeeSettingsHandler,
  UpdateOwnerHandler,
} from '@/modules/owners/application/commands/owner.handlers'
import { OwnerFeeResolver } from '@/modules/owners/application/owner-fee-resolver'
import { OwnerViews } from '@/modules/owners/application/owner.views'
import {
  CheckOwnerDataHandler,
  GetOwnerHandler,
  ListOwnersHandler,
} from '@/modules/owners/application/queries/owner.queries'
import { OwnerRepository } from '@/modules/owners/domain/owner.ports'
import { OwnersFacade } from '@/modules/owners/public/owners.facade'
import { PropertiesModule } from '@/modules/properties/public'
import { TenantsModule } from '@/modules/tenants/public'
import { OwnersController } from '../http/controllers/owners.controller'
import { OwnerRepositoryImpl } from '../repositories/owner.repository.impl'

/**
 * Propietarios (spec Fase 7, PRD 5.2).
 *
 * Propiedades y propietarios se consultan mutuamente (la propiedad muestra a
 * su dueño; el dueño, sus propiedades), cada uno por la facade del otro. De
 * ahí el `forwardRef` en los dos módulos. Las facades se importan desde su
 * archivo y no desde el `index` para que el ciclo de imports no las deje
 * `undefined` al armar los providers.
 */
@Module({
  imports: [forwardRef(() => PropertiesModule), TenantsModule],
  controllers: [OwnersController],
  providers: [
    { provide: OwnerRepository, useClass: OwnerRepositoryImpl },
    OwnerViews,
    OwnerFeeResolver,
    OwnersFacade,
    CreateOwnerHandler,
    UpdateOwnerHandler,
    UpdateOwnerBankAccountHandler,
    UpdateOwnerFeeSettingsHandler,
    IssueOwnerPortalCredentialsHandler,
    DeleteOwnerHandler,
    ListOwnersHandler,
    GetOwnerHandler,
    CheckOwnerDataHandler,
  ],
  exports: [OwnersFacade],
})
export class OwnersModule {}
