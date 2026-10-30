import { Module } from '@nestjs/common'

import { BillingModule } from '@/modules/billing/public'
import { ContractsModule } from '@/modules/contracts/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesModule } from '@/modules/properties/public'
import { RentersModule } from '@/modules/renters/public'
import { ServicesModule } from '@/modules/services/public'
import {
  CancelSettlementHandler,
  ConfirmSettlementHandler,
  CreateSettlementAdjustmentHandler,
  CreateSettlementHandler,
  RecalculateSettlementHandler,
  RegisterSettlementTransferHandler,
  VoidSettlementAdjustmentHandler,
  VoidSettlementTransferHandler,
} from '@/modules/settlements/application/commands/settlement.handlers'
import {
  RelaySettlementConfirmedHandler,
  RelayStatementClosedHandler,
} from '@/modules/settlements/application/events/settlement-events'
import { FeeAccountService } from '@/modules/settlements/application/fee-account.service'
import {
  GetSettlementHandler,
  ListSettlementsHandler,
} from '@/modules/settlements/application/queries/settlement.queries'
import { SettlementDrafts } from '@/modules/settlements/application/settlement-drafts'
import { SettlementReferences } from '@/modules/settlements/application/settlement-references'
import { SettlementViews } from '@/modules/settlements/application/settlement.views'
import { VoidedPaymentReaction } from '@/modules/settlements/application/voided-payment-reaction'
import {
  FeePaymentRepository,
  FeeReceivableRepository,
  OwnerStatementRepository,
  SettlementRepository,
} from '@/modules/settlements/domain/settlement.ports'
import { BillingEventsConsumer } from '../consumers/billing-events.consumer'
import { SettlementsController } from '../http/controllers/settlements.controller'
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
 * `app.module`. Escucha las colas de cobros por `BillingEventsConsumer`.
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
  controllers: [SettlementsController],
  providers: [
    { provide: SettlementRepository, useClass: SettlementRepositoryImpl },
    {
      provide: OwnerStatementRepository,
      useClass: OwnerStatementRepositoryImpl,
    },
    { provide: FeeReceivableRepository, useClass: FeeReceivableRepositoryImpl },
    { provide: FeePaymentRepository, useClass: FeePaymentRepositoryImpl },
    SettlementReferences,
    SettlementDrafts,
    SettlementViews,
    FeeAccountService,
    VoidedPaymentReaction,
    BillingEventsConsumer,
    CreateSettlementHandler,
    RecalculateSettlementHandler,
    CreateSettlementAdjustmentHandler,
    VoidSettlementAdjustmentHandler,
    ConfirmSettlementHandler,
    CancelSettlementHandler,
    RegisterSettlementTransferHandler,
    VoidSettlementTransferHandler,
    RelaySettlementConfirmedHandler,
    RelayStatementClosedHandler,
    ListSettlementsHandler,
    GetSettlementHandler,
  ],
})
export class SettlementsModule {}
