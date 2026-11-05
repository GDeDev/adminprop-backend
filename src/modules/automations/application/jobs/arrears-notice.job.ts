import { Injectable } from '@nestjs/common'

import { isPositiveMoney } from '@/shared/money'
import { BillingFacade } from '@/modules/billing/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import {
  NotificationChannel,
  NotificationRecipientKind,
} from '@/platform/notifications/notifications.port'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { JobName } from '../../domain/job-catalog'
import { AutomationJob, JobContext, JobOutcome } from '../job.types'
import { NoticeTally, skipped } from './notice-tally'

/**
 * Aviso de mora (Fase 13, 2, A-23). A cada cuota con saldo de alquiler y la
 * gracia vencida, una sola vez: el primer día en que el job corre después de
 * la gracia (no "el día 11": si el servidor estuvo caído, sale el 12). Al
 * inquilino y al personal, con base, días de atraso y punitorio a hoy. Mora
 * sólo por saldo de alquiler, no por cargos ni punitorio solos (A-26).
 */
@Injectable()
export class ArrearsNoticeJob implements AutomationJob {
  readonly name = JobName.ARREARS_NOTICE

  constructor(
    private readonly billing: BillingFacade,
    private readonly renters: RentersFacade,
    private readonly properties: PropertiesFacade,
    private readonly notifications: NotificationsService,
  ) {}

  async run(context: JobContext): Promise<JobOutcome> {
    const overdue = (await this.billing.listOverdue(context.today)).filter(
      (installment) => isPositiveMoney(installment.rentBalance),
    )
    if (overdue.length === 0) return skipped('Ninguna cuota en mora')

    const [renters, properties] = await Promise.all([
      this.renters.contacts(overdue.map((i) => i.renterId)),
      this.properties.describe(overdue.map((i) => i.propertyId)),
    ])
    const tally = new NoticeTally()
    for (const installment of overdue) {
      const renter = renters.get(installment.renterId)
      const data = {
        renterName: renter?.fullName ?? null,
        propertyAddress:
          properties.get(installment.propertyId)?.address ?? null,
        period: installment.period,
        currency: installment.currency,
        rentBalance: installment.rentBalance,
        daysOverdue: installment.daysOverdue,
        lateFeeBalance: installment.lateFeeBalance,
        totalDue: installment.totalDue,
      }
      const entity = { type: 'INSTALLMENT', id: installment.id }

      tally.add(
        await this.notifications.send({
          tenantId: context.tenantId!,
          type: 'ARREARS_NOTICE',
          recipient: {
            kind: NotificationRecipientKind.RENTER,
            id: installment.renterId,
            email: renter?.email,
            phone: renter?.phone,
          },
          entity,
          dedupeKey: `ARREARS_NOTICE:${installment.id}:renter`,
          channels: [
            NotificationChannel.EMAIL,
            NotificationChannel.WHATSAPP_LINK,
          ],
          data,
        }),
      )
      // El personal se entera de la misma mora; no se cuenta aparte.
      await this.notifications.send({
        tenantId: context.tenantId!,
        type: 'ARREARS_NOTICE',
        recipient: { kind: NotificationRecipientKind.TENANT_STAFF },
        entity,
        dedupeKey: `ARREARS_NOTICE:${installment.id}:staff`,
        channels: [NotificationChannel.EMAIL],
        data,
      })
    }
    return tally.outcome('avisos de mora')
  }
}
