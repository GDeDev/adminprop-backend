import { Injectable } from '@nestjs/common'

import { CrmFacade } from '@/modules/crm/public'
import { JobExecutionStatus, JobName } from '../../domain/job-catalog'
import { AutomationJob, JobOutcome } from '../job.types'
import { skipped } from './notice-tally'

/**
 * Trae las consultas de los portales conectados (Fase 23, 6.2) y las deja en
 * el CRM como `NEW`. Idempotente: se deduplican por el id de la consulta en el
 * portal. Sin canales conectados no hace nada.
 */
@Injectable()
export class CrmPullChannelInquiriesJob implements AutomationJob {
  readonly name = JobName.CRM_PULL_CHANNEL_INQUIRIES

  constructor(private readonly crm: CrmFacade) {}

  async run(): Promise<JobOutcome> {
    const summary = await this.crm.pullChannelInquiries()
    if (summary.channels === 0) return skipped('Ningún portal conectado')
    return {
      status:
        summary.failed > 0
          ? summary.failed === summary.channels
            ? JobExecutionStatus.FAILED
            : JobExecutionStatus.PARTIAL
          : JobExecutionStatus.SUCCEEDED,
      affected: summary.created,
      summary: `${summary.channels} portales, ${summary.fetched} consultas leídas, ${summary.created} nuevas${summary.failed > 0 ? `, ${summary.failed} portales con error` : ''}`,
      details: { ...summary },
    }
  }
}
