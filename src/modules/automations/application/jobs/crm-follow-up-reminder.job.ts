import { Injectable } from '@nestjs/common'

import { CrmFacade } from '@/modules/crm/public'
import { JobExecutionStatus, JobName } from '../../domain/job-catalog'
import { AutomationJob, JobContext, JobOutcome } from '../job.types'
import { skipped } from './notice-tally'

/**
 * Recordatorio de seguimiento de consultas (Fase 23, 4.1). Por cada consulta
 * abierta con la fecha de seguimiento vencida, un aviso interno una sola vez
 * por fecha (la clave de dedupe lleva la fecha de seguimiento).
 */
@Injectable()
export class CrmFollowUpReminderJob implements AutomationJob {
  readonly name = JobName.CRM_FOLLOW_UP_REMINDER

  constructor(private readonly crm: CrmFacade) {}

  async run(context: JobContext): Promise<JobOutcome> {
    const summary = await this.crm.sendFollowUpReminders(context.today)
    if (summary.due === 0)
      return skipped('Ninguna consulta con seguimiento vencido')
    return {
      status:
        summary.failed > 0
          ? JobExecutionStatus.PARTIAL
          : JobExecutionStatus.SUCCEEDED,
      affected: summary.notified,
      summary: `${summary.due} consultas con seguimiento vencido, ${summary.notified} avisos nuevos${summary.failed > 0 ? `, ${summary.failed} con error` : ''}`,
      details: { ...summary },
    }
  }
}
