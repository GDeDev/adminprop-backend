import { Injectable } from '@nestjs/common'

import { BillingFacade } from '@/modules/billing/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { TenantsFacade } from '@/modules/tenants/public'
import {
  NotificationChannel,
  NotificationRecipientKind,
} from '@/platform/notifications/notifications.port'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { periodOf } from '@/shared/dates/calendar-date'
import { JobName } from '../../domain/job-catalog'
import { AutomationJob, JobContext, JobOutcome } from '../job.types'
import { NoticeTally, skipped } from './notice-tally'

/**
 * Recordatorio de pago al inquilino (Fase 13, 2). Desde el día
 * `paymentReminderDay` y hasta que termina la gracia de la cuota (después
 * toma el aviso de mora), a cada cuota del mes `PENDING` y sin ningún pago
 * (A-26). Un servidor caído el día del recordatorio lo manda al día siguiente;
 * `notification_log` evita repetirlo.
 */
@Injectable()
export class PaymentReminderJob implements AutomationJob {
  readonly name = JobName.PAYMENT_REMINDER

  constructor(
    private readonly billing: BillingFacade,
    private readonly tenants: TenantsFacade,
    private readonly renters: RentersFacade,
    private readonly properties: PropertiesFacade,
    private readonly notifications: NotificationsService,
  ) {}

  async run(context: JobContext): Promise<JobOutcome> {
    const { paymentReminderDay } = await this.tenants.getBillingSettings(
      context.tenantId!,
    )
    const dayOfMonth = Number(context.today.slice(8, 10))
    if (!context.manual && dayOfMonth < paymentReminderDay) {
      return skipped(
        `Todavía no es el día de recordatorio (día ${paymentReminderDay})`,
      )
    }

    const period = context.period ?? periodOf(context.today)
    const due = (await this.billing.listPendingForReminder(period)).filter(
      (installment) =>
        context.manual || context.today <= installment.graceEndDate,
    )
    if (due.length === 0) {
      return skipped(`Ninguna cuota de ${period} para recordar`)
    }

    const [renters, properties] = await Promise.all([
      this.renters.contacts(due.map((i) => i.renterId)),
      this.properties.describe(due.map((i) => i.propertyId)),
    ])
    const tally = new NoticeTally()
    for (const installment of due) {
      const renter = renters.get(installment.renterId)
      tally.add(
        await this.notifications.send({
          tenantId: context.tenantId!,
          type: 'PAYMENT_REMINDER',
          recipient: {
            kind: NotificationRecipientKind.RENTER,
            id: installment.renterId,
            email: renter?.email,
            phone: renter?.phone,
          },
          entity: { type: 'INSTALLMENT', id: installment.id },
          dedupeKey: `PAYMENT_REMINDER:${installment.id}`,
          channels: [
            NotificationChannel.EMAIL,
            NotificationChannel.WHATSAPP_LINK,
          ],
          data: {
            renterName: renter?.fullName ?? null,
            propertyAddress:
              properties.get(installment.propertyId)?.address ?? null,
            period: installment.period,
            amount: installment.baseAmount,
            currency: installment.currency,
            lastDayWithoutLateFee: installment.graceEndDate,
          },
        }),
      )
    }
    return tally.outcome('recordatorios', { period })
  }
}
