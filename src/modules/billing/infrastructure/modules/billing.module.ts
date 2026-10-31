import { Module } from '@nestjs/common'

import { BillingReferences } from '@/modules/billing/application/billing-references'
import { GenerateInstallmentsHandler } from '@/modules/billing/application/commands/generate-installments.handler'
import {
  AdjustLateFeeHandler,
  CreateChargeHandler,
  VoidChargeHandler,
} from '@/modules/billing/application/commands/installment.handlers'
import {
  ApplyCreditHandler,
  ConfirmPaymentHandler,
  RefundCreditHandler,
  RegisterPaymentHandler,
  VoidPaymentHandler,
} from '@/modules/billing/application/commands/payment.handlers'
import { RegisterDepositReturnHandler } from '@/modules/billing/application/commands/deposit-return.handler'
import { RelayInstallmentPaidHandler } from '@/modules/billing/application/events/relay-installment-paid.handler'
import {
  RelayPaymentConfirmedHandler,
  RelayPaymentVoidedHandler,
} from '@/modules/billing/application/events/relay-payment-events.handler'
import { InstallmentGenerator } from '@/modules/billing/application/installment-generator'
import { InstallmentRebaser } from '@/modules/billing/application/installment-rebaser'
import { ContractEventsConsumer } from '../consumers/contract-events.consumer'
import { InstallmentRecalculator } from '@/modules/billing/application/installment-recalculator'
import { InstallmentViews } from '@/modules/billing/application/installment.views'
import {
  GetArrearsHandler,
  GetBillingSummaryHandler,
  GetContractAccountHandler,
  GetInstallmentBreakdownHandler,
  GetInstallmentHandler,
  ListInstallmentsHandler,
  ListPaymentsHandler,
  ListRenterCreditsHandler,
} from '@/modules/billing/application/queries/billing.queries'
import { BillingFacade } from '@/modules/billing/public/billing.facade'
import {
  DepositReturnRepository,
  InstallmentRepository,
  PaymentRepository,
  RenterCreditRepository,
} from '@/modules/billing/domain/billing.ports'
import { ContractsModule } from '@/modules/contracts/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesModule } from '@/modules/properties/public'
import { RentersModule } from '@/modules/renters/public'
import { InstallmentsController } from '../http/controllers/billing.controller'
import { PaymentsController } from '../http/controllers/payments.controller'
import { DepositReturnRepositoryImpl } from '../repositories/deposit-return.repository.impl'
import { InstallmentRepositoryImpl } from '../repositories/installment.repository.impl'
import { PaymentRepositoryImpl } from '../repositories/payment.repository.impl'
import { RenterCreditRepositoryImpl } from '../repositories/renter-credit.repository.impl'

/**
 * Cobros y punitorios (spec Fase 11, rediseño). Depende de contratos,
 * inquilinos, propietarios y propiedades por sus facades, y de auth (global)
 * para nombrar usuarios; ninguno de ellos importa a cobros.
 */
@Module({
  imports: [ContractsModule, RentersModule, OwnersModule, PropertiesModule],
  controllers: [InstallmentsController, PaymentsController],
  providers: [
    { provide: InstallmentRepository, useClass: InstallmentRepositoryImpl },
    { provide: PaymentRepository, useClass: PaymentRepositoryImpl },
    { provide: RenterCreditRepository, useClass: RenterCreditRepositoryImpl },
    { provide: DepositReturnRepository, useClass: DepositReturnRepositoryImpl },
    BillingReferences,
    InstallmentViews,
    InstallmentGenerator,
    InstallmentRecalculator,
    InstallmentRebaser,
    ContractEventsConsumer,
    BillingFacade,
    GenerateInstallmentsHandler,
    CreateChargeHandler,
    VoidChargeHandler,
    AdjustLateFeeHandler,
    RegisterPaymentHandler,
    ApplyCreditHandler,
    ConfirmPaymentHandler,
    VoidPaymentHandler,
    RefundCreditHandler,
    RegisterDepositReturnHandler,
    RelayInstallmentPaidHandler,
    RelayPaymentConfirmedHandler,
    RelayPaymentVoidedHandler,
    ListInstallmentsHandler,
    GetBillingSummaryHandler,
    GetInstallmentHandler,
    GetInstallmentBreakdownHandler,
    GetContractAccountHandler,
    ListPaymentsHandler,
    ListRenterCreditsHandler,
    GetArrearsHandler,
  ],
  exports: [BillingFacade],
})
export class BillingModule {}
