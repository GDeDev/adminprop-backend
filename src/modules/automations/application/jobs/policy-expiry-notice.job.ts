import { Injectable } from '@nestjs/common'

import { ContractsFacade } from '@/modules/contracts/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import {
  NotificationChannel,
  NotificationRecipientKind,
} from '@/platform/notifications/notifications.port'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { daysBetween } from '@/shared/dates/calendar-date'
import { JobName } from '../../domain/job-catalog'
import { AutomationJob, JobContext, JobOutcome } from '../job.types'
import { NoticeTally, skipped } from './notice-tally'

/** Con cuántos días de anticipación se avisa que una póliza vence. */
export const POLICY_NOTICE_DAYS = 30

/**
 * Pólizas de caución (Fase 13, 2): `POLICY_EXPIRING` a los 30 días o menos del
 * vencimiento y `POLICY_EXPIRED` cuando ya venció, al personal. "Caución
 * vencida" ya se calcula al leer (D-50/D-61): no se marca nada en el
 * contrato. La clave lleva la fecha de vencimiento: una póliza renovada
 * (otra fecha) vuelve a avisar.
 */
@Injectable()
export class PolicyExpiryNoticeJob implements AutomationJob {
  readonly name = JobName.POLICY_EXPIRY_NOTICE

  constructor(
    private readonly contracts: ContractsFacade,
    private readonly renters: RentersFacade,
    private readonly properties: PropertiesFacade,
    private readonly notifications: NotificationsService,
  ) {}

  async run(context: JobContext): Promise<JobOutcome> {
    const withPolicy = (await this.contracts.listWithSurety()).filter(
      (c) => c.policyExpiresAt !== null,
    )
    const relevant = withPolicy.filter(
      (c) =>
        daysBetween(context.today, c.policyExpiresAt!) <= POLICY_NOTICE_DAYS,
    )
    if (relevant.length === 0) return skipped('Ninguna póliza por vencer')

    const [renters, properties] = await Promise.all([
      this.renters.describe(relevant.map((c) => c.renterId)),
      this.properties.describe(relevant.map((c) => c.propertyId)),
    ])
    const tally = new NoticeTally()
    for (const contract of relevant) {
      const daysLeft = daysBetween(context.today, contract.policyExpiresAt!)
      const type = daysLeft < 0 ? 'POLICY_EXPIRED' : 'POLICY_EXPIRING'
      tally.add(
        await this.notifications.send({
          tenantId: context.tenantId!,
          type,
          recipient: { kind: NotificationRecipientKind.TENANT_STAFF },
          entity: { type: 'CONTRACT', id: contract.id },
          dedupeKey: `${type}:${contract.id}:${contract.policyExpiresAt}`,
          channels: [NotificationChannel.EMAIL],
          data: {
            propertyAddress:
              properties.get(contract.propertyId)?.address ?? null,
            renterName: renters.get(contract.renterId)?.fullName ?? null,
            insurerName: contract.insurerName,
            policyNumber: contract.policyNumber,
            policyExpiresAt: contract.policyExpiresAt,
            daysLeft,
          },
        }),
      )
    }
    return tally.outcome('avisos de póliza')
  }
}
