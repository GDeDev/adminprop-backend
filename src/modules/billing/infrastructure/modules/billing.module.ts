import { Module } from '@nestjs/common'

import { BillingReferences } from '@/modules/billing/application/billing-references'
import { GenerateInstallmentsHandler } from '@/modules/billing/application/commands/generate-installments.handler'
import { InstallmentGenerator } from '@/modules/billing/application/installment-generator'
import { InstallmentViews } from '@/modules/billing/application/installment.views'
import {
  GetBillingSummaryHandler,
  GetContractAccountHandler,
  GetInstallmentBreakdownHandler,
  GetInstallmentHandler,
  ListInstallmentsHandler,
} from '@/modules/billing/application/queries/billing.queries'
import {
  InstallmentRepository,
  PaymentRepository,
  RenterCreditRepository,
} from '@/modules/billing/domain/billing.ports'
import { ContractsModule } from '@/modules/contracts/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesModule } from '@/modules/properties/public'
import { RentersModule } from '@/modules/renters/public'
import { InstallmentsController } from '../http/controllers/billing.controller'
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
  controllers: [InstallmentsController],
  providers: [
    { provide: InstallmentRepository, useClass: InstallmentRepositoryImpl },
    { provide: PaymentRepository, useClass: PaymentRepositoryImpl },
    { provide: RenterCreditRepository, useClass: RenterCreditRepositoryImpl },
    BillingReferences,
    InstallmentViews,
    InstallmentGenerator,
    GenerateInstallmentsHandler,
    ListInstallmentsHandler,
    GetBillingSummaryHandler,
    GetInstallmentHandler,
    GetInstallmentBreakdownHandler,
    GetContractAccountHandler,
  ],
  exports: [],
})
export class BillingModule {}
