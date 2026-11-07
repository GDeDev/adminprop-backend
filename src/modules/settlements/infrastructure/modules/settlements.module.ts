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
import {
  AllocateFeePaymentHandler,
  RegisterFeePaymentHandler,
  VoidFeePaymentHandler,
} from '@/modules/settlements/application/commands/fee.handlers'
import {
  AddStatementSettlementsHandler,
  CloseStatementHandler,
  CreateStatementHandler,
  RemoveStatementSettlementHandler,
  ReopenStatementHandler,
} from '@/modules/settlements/application/commands/statement.handlers'
import { FeeAccountService } from '@/modules/settlements/application/fee-account.service'
import { FeeViews } from '@/modules/settlements/application/fee.views'
import { OwnerDirectFeeReaction } from '@/modules/settlements/application/owner-direct-fee-reaction'
import {
  GetOwnerFeeAccountHandler,
  GetStatementHandler,
  ListFeeReceivablesHandler,
  ListStatementCandidatesHandler,
  ListStatementsHandler,
} from '@/modules/settlements/application/queries/statement.queries'
import { StatementViews } from '@/modules/settlements/application/statement.views'
import { SettlementsFacade } from '@/modules/settlements/public/settlements.facade'
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
import { FeesController } from '../http/controllers/fees.controller'
import { SettlementsController } from '../http/controllers/settlements.controller'
import { StatementsController } from '../http/controllers/statements.controller'
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
  controllers: [SettlementsController, StatementsController, FeesController],
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
    StatementViews,
    FeeViews,
    FeeAccountService,
    VoidedPaymentReaction,
    OwnerDirectFeeReaction,
    BillingEventsConsumer,
    SettlementsFacade,
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
    CreateStatementHandler,
    AddStatementSettlementsHandler,
    RemoveStatementSettlementHandler,
    CloseStatementHandler,
    ReopenStatementHandler,
    RegisterFeePaymentHandler,
    VoidFeePaymentHandler,
    AllocateFeePaymentHandler,
    ListStatementsHandler,
    GetStatementHandler,
    ListStatementCandidatesHandler,
    ListFeeReceivablesHandler,
    GetOwnerFeeAccountHandler,
  ],
  exports: [SettlementsFacade],
})
export class SettlementsModule {}
