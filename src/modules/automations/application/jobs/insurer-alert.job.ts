import { Injectable } from '@nestjs/common'

import { BillingFacade } from '@/modules/billing/public'
import { ContractsFacade } from '@/modules/contracts/public'
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
 * Alerta a la aseguradora (Fase 13, 2; PRD 13.5, A-27). Por cada cuota del
 * mes en curso de un contrato con caución cuyo saldo de alquiler siga > 0
 * **al cierre del día `paymentReminderDay`**: desde el día siguiente. Con
 * una gracia de 10 días esto avisa antes de que haya mora, como pide el PRD.
 * Una vez por cuota. Sin email de la aseguradora cargado no hay a quién
 * avisar: se cuenta en el detalle.
 */
@Injectable()
export class InsurerAlertJob implements AutomationJob {
  readonly name = JobName.INSURER_ALERT

  constructor(
    private readonly billing: BillingFacade,
    private readonly contracts: ContractsFacade,
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
    if (!context.manual && dayOfMonth <= paymentReminderDay) {
      return skipped(
        `Se avisa desde el día siguiente al recordatorio (día ${paymentReminderDay})`,
      )
    }

    const period = context.period ?? periodOf(context.today)
    const [unpaid, withSurety] = await Promise.all([
      this.billing.listWithRentDue(period, context.today),
      this.contracts.listWithSurety(),
    ])
    const suretyByContract = new Map(withSurety.map((c) => [c.id, c]))
    const candidates = unpaid.filter((i) => suretyByContract.has(i.contractId))
    if (candidates.length === 0) {
      return skipped(`Ninguna cuota de ${period} con caución impaga`)
    }

    const [renters, properties] = await Promise.all([
      this.renters.contacts(candidates.map((i) => i.renterId)),
      this.properties.describe(candidates.map((i) => i.propertyId)),
    ])
    const tally = new NoticeTally()
    let withoutEmail = 0
    for (const installment of candidates) {
      const surety = suretyByContract.get(installment.contractId)!
      if (!surety.insurerAlertEmail) {
        withoutEmail += 1
        continue
      }
      const renter = renters.get(installment.renterId)
      tally.add(
        await this.notifications.send({
          tenantId: context.tenantId!,
          type: 'INSURER_ALERT',
          recipient: {
            kind: NotificationRecipientKind.INSURER,
            email: surety.insurerAlertEmail,
          },
          entity: { type: 'INSTALLMENT', id: installment.id },
          dedupeKey: `INSURER_ALERT:${installment.id}`,
          channels: [NotificationChannel.EMAIL],
          data: {
            insurerName: surety.insurerName,
            policyNumber: surety.policyNumber,
            renterName: renter?.fullName ?? null,
            renterNationalId: renter?.nationalId ?? null,
            propertyAddress:
              properties.get(installment.propertyId)?.address ?? null,
            period: installment.period,
            amount: installment.rentBalance,
            currency: installment.currency,
          },
        }),
      )
    }
    return tally.outcome(
      'alertas',
      { period, withoutInsurerEmail: withoutEmail },
      withoutEmail > 0
        ? `, ${withoutEmail} sin email de la aseguradora cargado`
        : '',
    )
  }
}
