import { Module } from '@nestjs/common'

import { BillingModule } from '@/modules/billing/public'
import { ContractsModule } from '@/modules/contracts/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesModule } from '@/modules/properties/public'
import { RentersModule } from '@/modules/renters/public'
import { ServicesModule } from '@/modules/services/public'
import { SettlementsModule } from '@/modules/settlements/public'
import { TenantsModule } from '@/modules/tenants/public'
import { AcknowledgeSettlementHandler } from '../../application/commands/acknowledge-settlement.handler'
import { PortalIdentity } from '../../application/portal-identity'
import {
  GetOwnerAccountHandler,
  GetOwnerMeHandler,
  GetOwnerSettlementHandler,
  GetOwnerSettlementPdfUrlHandler,
  GetOwnerStatementHandler,
  GetOwnerStatementPdfUrlHandler,
  ListOwnerPropertiesHandler,
  ListOwnerPropertyInstallmentsHandler,
  ListOwnerSettlementsHandler,
  ListOwnerStatementsHandler,
} from '../../application/queries/owner-portal.queries'
import {
  GetRenterAccountHandler,
  GetRenterContractHandler,
  GetRenterInstallmentHandler,
  GetRenterMeHandler,
  GetRenterReceiptUrlHandler,
  ListRenterInstallmentsHandler,
} from '../../application/queries/renter-portal.queries'
import { PortalOwnerController } from '../http/controllers/portal-owner.controller'
import { PortalRenterController } from '../http/controllers/portal-renter.controller'

/**
 * Portales de inquilinos y propietarios (Fases 17 y 18). Sólo lectura, salvo
 * el acuse de recibo de una transferencia. No tiene tablas ni repositorios:
 * consume las facades de cobros, liquidaciones, contratos, propiedades,
 * propietarios, inquilinos, servicios e inmobiliarias. Nadie lo importa salvo
 * `app.module`.
 */
@Module({
  imports: [
    BillingModule,
    SettlementsModule,
    ContractsModule,
    PropertiesModule,
    OwnersModule,
    RentersModule,
    ServicesModule,
    TenantsModule,
  ],
  controllers: [PortalRenterController, PortalOwnerController],
  providers: [
    PortalIdentity,
    GetRenterMeHandler,
    GetRenterContractHandler,
    GetRenterAccountHandler,
    ListRenterInstallmentsHandler,
    GetRenterInstallmentHandler,
    GetRenterReceiptUrlHandler,
    GetOwnerMeHandler,
    ListOwnerPropertiesHandler,
    GetOwnerAccountHandler,
    ListOwnerSettlementsHandler,
    GetOwnerSettlementHandler,
    GetOwnerSettlementPdfUrlHandler,
    ListOwnerStatementsHandler,
    GetOwnerStatementHandler,
    GetOwnerStatementPdfUrlHandler,
    ListOwnerPropertyInstallmentsHandler,
    AcknowledgeSettlementHandler,
  ],
})
export class PortalModule {}
