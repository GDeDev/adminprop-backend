import { Module } from '@nestjs/common'

import {
  FeePaymentRepository,
  FeeReceivableRepository,
  OwnerStatementRepository,
  SettlementRepository,
} from '@/modules/settlements/domain/settlement.ports'
import { BillingModule } from '@/modules/billing/public'
import { ContractsModule } from '@/modules/contracts/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesModule } from '@/modules/properties/public'
import { RentersModule } from '@/modules/renters/public'
import { ServicesModule } from '@/modules/services/public'
import {
  FeePaymentRepositoryImpl,
  FeeReceivableRepositoryImpl,
} from '../repositories/fee.repository.impl'
import { OwnerStatementRepositoryImpl } from '../repositories/owner-statement.repository.impl'
import { SettlementRepositoryImpl } from '../repositories/settlement.repository.impl'

/**
 * Liquidaciones (spec Fase 12, rediseño). Depende de cobros, servicios,
 * contratos, propietarios, propiedades e inquilinos por sus facades, y de
 * auth (global) para nombrar usuarios; nadie importa a liquidaciones salvo
 * `app.module`.
 */
@Module({
  imports: [
    BillingModule,
    ServicesModule,
    ContractsModule,
    OwnersModule,
    PropertiesModule,
    RentersModule,
  ],
  providers: [
    { provide: SettlementRepository, useClass: SettlementRepositoryImpl },
    {
      provide: OwnerStatementRepository,
      useClass: OwnerStatementRepositoryImpl,
    },
    { provide: FeeReceivableRepository, useClass: FeeReceivableRepositoryImpl },
    { provide: FeePaymentRepository, useClass: FeePaymentRepositoryImpl },
  ],
})
export class SettlementsModule {}
