import { Injectable } from '@nestjs/common'

import { OwnersFacade } from '@/modules/owners/public'
import { SettlementsFacade } from '@/modules/settlements/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { periodOf, previousPeriod } from '@/shared/dates/calendar-date'
import { JobName } from '../../domain/job-catalog'
import { AutomationJob, JobContext, JobOutcome } from '../job.types'
import { NoticeTally, skipped } from './notice-tally'

/**
 * Recordatorio de consolidados (Fase 13, 2). Desde el día `monthlyReportDay`,
 * por cada propietario con liquidaciones confirmadas del mes anterior que no
 * entraron en ningún consolidado, un aviso interno. El cierre es manual
 * (Micaela #7): el cron no consolida, sólo recuerda. Una vez por propietario
 * y mes.
 */
@Injectable()
export class StatementReminderJob implements AutomationJob {
  readonly name = JobName.STATEMENT_REMINDER

  constructor(
    private readonly settlements: SettlementsFacade,
    private readonly owners: OwnersFacade,
    private readonly tenants: TenantsFacade,
    private readonly notifications: NotificationsService,
  ) {}

  async run(context: JobContext): Promise<JobOutcome> {
    const { monthlyReportDay } = await this.tenants.getAutomationSettings(
      context.tenantId!,
    )
    const dayOfMonth = Number(context.today.slice(8, 10))
    if (!context.manual && dayOfMonth < monthlyReportDay) {
      return skipped(
        `Todavía no es el día del informe mensual (día ${monthlyReportDay})`,
      )
    }

    const period = context.period ?? previousPeriod(periodOf(context.today))
    const pending = await this.settlements.ownersPendingStatement(period)
    if (pending.length === 0) {
      return skipped(`Ningún consolidado pendiente de ${period}`)
    }

    const owners = await this.owners.describe(pending.map((p) => p.ownerId))
    const tally = new NoticeTally()
    for (const { ownerId, settlements } of pending) {
      const name = owners.get(ownerId)?.fullName ?? 'Un propietario'
      tally.add(
        await this.notifications.notifyStaff({
          tenantId: context.tenantId!,
          type: 'STATEMENT_PENDING',
          title: 'Consolidado pendiente',
          body:
            `${name} tiene ${settlements} ` +
            `${settlements === 1 ? 'liquidación' : 'liquidaciones'} de ${period} ` +
            'sin consolidar.',
          dedupeKey: `STATEMENT_PENDING:${ownerId}:${period}`,
          entity: { type: 'OWNER', id: ownerId },
          link: '/liquidaciones/consolidados',
        }),
      )
    }
    return tally.outcome('avisos de consolidado', { period })
  }
}
