import { IdempotencyService } from '@/shared/idempotency/idempotency.service'
import { Module } from '@nestjs/common'

import {
  GetIndexStatusHandler,
  ListAlertsHandler,
  ListExecutionsHandler,
  ListJobsHandler,
  MarkAlertReadHandler,
  MarkAllAlertsReadHandler,
  RunJobHandler,
} from '@/modules/automations/application/automation.handlers'
import { AutomationViews } from '@/modules/automations/application/automation.views'
import { JobRegistry } from '@/modules/automations/application/job-registry'
import { JobRunner } from '@/modules/automations/application/job-runner'
import { JobScheduler } from '@/modules/automations/application/job-scheduler'
import { CrmFollowUpReminderJob } from '@/modules/automations/application/jobs/crm-follow-up-reminder.job'
import { CrmPullChannelInquiriesJob } from '@/modules/automations/application/jobs/crm-pull-channel-inquiries.job'
import { CrmModule } from '@/modules/crm/public'
import { ArrearsNoticeJob } from '@/modules/automations/application/jobs/arrears-notice.job'
import { ContractExpiryNoticeJob } from '@/modules/automations/application/jobs/contract-expiry-notice.job'
import { FinishExpiredContractsJob } from '@/modules/automations/application/jobs/finish-expired-contracts.job'
import { GenerateInstallmentsJob } from '@/modules/automations/application/jobs/generate-installments.job'
import { IndicesFetchJob } from '@/modules/automations/application/jobs/indices-fetch.job'
import { InsurerAlertJob } from '@/modules/automations/application/jobs/insurer-alert.job'
import { PaymentReminderJob } from '@/modules/automations/application/jobs/payment-reminder.job'
import { PolicyExpiryNoticeJob } from '@/modules/automations/application/jobs/policy-expiry-notice.job'
import { RentUpdatesJob } from '@/modules/automations/application/jobs/rent-updates.job'
import { ServiceOverdueNoticeJob } from '@/modules/automations/application/jobs/service-overdue-notice.job'
import { DiscardStaleImportBatchesJob } from '@/modules/automations/application/jobs/discard-stale-import-batches.job'
import { RefreshComparablesJob } from '@/modules/automations/application/jobs/refresh-comparables.job'
import { StatementReminderJob } from '@/modules/automations/application/jobs/statement-reminder.job'
import {
  AlertRepository,
  JobExecutionRepository,
} from '@/modules/automations/domain/automations.ports'
import { AuditRecorderModule } from '@/modules/audit/public'
import { AutomationsFacade } from '@/modules/automations/public/automations.facade'
import { BillingModule } from '@/modules/billing/public'
import { ContractsModule } from '@/modules/contracts/public'
import { IndicesModule } from '@/modules/indices/public'
import { MigrationModule } from '@/modules/migration/public'
import { MasterDataModule } from '@/modules/master-data/public'
import { OwnersModule } from '@/modules/owners/public'
import { PropertiesModule } from '@/modules/properties/public'
import { RentersModule } from '@/modules/renters/public'
import { ServicesModule } from '@/modules/services/public'
import { SettlementsModule } from '@/modules/settlements/public'
import { TenantsModule } from '@/modules/tenants/public'
import { ValuationModule } from '@/modules/valuation/public'
import { JobsConsumer } from '../consumers/jobs.consumer'
import {
  AutomationsController,
  IndexStatusController,
} from '../http/controllers/automations.controller'
import { AlertRepositoryImpl } from '../repositories/alert.repository.impl'
import { JobExecutionRepositoryImpl } from '../repositories/job-execution.repository.impl'
import { CronSchedulerTask } from '../tasks/cron-scheduler.task'

/**
 * Automatizaciones (spec Fase 13, rediseño): el scheduler, los jobs de
 * negocio, su historial y los avisos internos. Es el único módulo que conoce
 * a casi todos los demás, y por sus facades; nadie lo importa salvo
 * `app.module`. Los avisos salen por `NotificationsPort` (platform) y los
 * índices entran por `IndexSourcePort`.
 */
@Module({
  imports: [
    TenantsModule,
    ContractsModule,
    BillingModule,
    IndicesModule,
    ServicesModule,
    SettlementsModule,
    OwnersModule,
    RentersModule,
    PropertiesModule,
    MasterDataModule,
    MigrationModule,
    ValuationModule,
    CrmModule,
    AuditRecorderModule,
  ],
  controllers: [AutomationsController, IndexStatusController],
  providers: [
    { provide: JobExecutionRepository, useClass: JobExecutionRepositoryImpl },
    { provide: AlertRepository, useClass: AlertRepositoryImpl },
    AutomationViews,
    JobScheduler,
    IdempotencyService,
    JobRunner,
    JobRegistry,
    GenerateInstallmentsJob,
    RentUpdatesJob,
    FinishExpiredContractsJob,
    IndicesFetchJob,
    PaymentReminderJob,
    ArrearsNoticeJob,
    InsurerAlertJob,
    ContractExpiryNoticeJob,
    PolicyExpiryNoticeJob,
    ServiceOverdueNoticeJob,
    StatementReminderJob,
    DiscardStaleImportBatchesJob,
    RefreshComparablesJob,
    CrmFollowUpReminderJob,
    CrmPullChannelInquiriesJob,
    JobsConsumer,
    CronSchedulerTask,
    ListJobsHandler,
    ListExecutionsHandler,
    RunJobHandler,
    ListAlertsHandler,
    MarkAlertReadHandler,
    MarkAllAlertsReadHandler,
    GetIndexStatusHandler,
    AutomationsFacade,
  ],
  exports: [AutomationsFacade],
})
export class AutomationsModule {}
