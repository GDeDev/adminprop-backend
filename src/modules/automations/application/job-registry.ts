import { Injectable } from '@nestjs/common'

import { JobName } from '../domain/job-catalog'
import { AutomationJob } from './job.types'
import { ArrearsNoticeJob } from './jobs/arrears-notice.job'
import { ContractExpiryNoticeJob } from './jobs/contract-expiry-notice.job'
import { DiscardStaleImportBatchesJob } from './jobs/discard-stale-import-batches.job'
import { FinishExpiredContractsJob } from './jobs/finish-expired-contracts.job'
import { GenerateInstallmentsJob } from './jobs/generate-installments.job'
import { InsurerAlertJob } from './jobs/insurer-alert.job'
import { IndicesFetchJob } from './jobs/indices-fetch.job'
import { PaymentReminderJob } from './jobs/payment-reminder.job'
import { RefreshComparablesJob } from './jobs/refresh-comparables.job'
import { PolicyExpiryNoticeJob } from './jobs/policy-expiry-notice.job'
import { RentUpdatesJob } from './jobs/rent-updates.job'
import { ServiceOverdueNoticeJob } from './jobs/service-overdue-notice.job'
import { StatementReminderJob } from './jobs/statement-reminder.job'

/** Los jobs por nombre. Sumar un job: clase nueva, entrada acá y en el catálogo. */
@Injectable()
export class JobRegistry {
  private readonly jobs: Map<string, AutomationJob>

  constructor(
    generateInstallments: GenerateInstallmentsJob,
    rentUpdates: RentUpdatesJob,
    finishExpired: FinishExpiredContractsJob,
    indicesFetch: IndicesFetchJob,
    paymentReminder: PaymentReminderJob,
    arrearsNotice: ArrearsNoticeJob,
    insurerAlert: InsurerAlertJob,
    contractExpiry: ContractExpiryNoticeJob,
    policyExpiry: PolicyExpiryNoticeJob,
    serviceOverdue: ServiceOverdueNoticeJob,
    statementReminder: StatementReminderJob,
    discardStaleBatches: DiscardStaleImportBatchesJob,
    refreshComparables: RefreshComparablesJob,
  ) {
    this.jobs = new Map(
      [
        generateInstallments,
        rentUpdates,
        finishExpired,
        indicesFetch,
        paymentReminder,
        arrearsNotice,
        insurerAlert,
        contractExpiry,
        policyExpiry,
        serviceOverdue,
        statementReminder,
        discardStaleBatches,
        refreshComparables,
      ].map((job) => [job.name, job]),
    )
  }

  get(name: JobName | string): AutomationJob {
    const job = this.jobs.get(name)
    if (!job) throw new Error(`Job sin implementación: ${name}`)
    return job
  }
}
