import { Injectable } from '@nestjs/common'

import { ContractsFacade } from '@/modules/contracts/public'
import { OwnersFacade } from '@/modules/owners/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { TenantsFacade } from '@/modules/tenants/public'
import {
  NotificationChannel,
  NotificationRecipientKind,
} from '@/platform/notifications/notifications.port'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { JobName } from '../../domain/job-catalog'
import { AutomationJob, JobContext, JobOutcome } from '../job.types'
import { NoticeTally, skipped } from './notice-tally'

/**
 * Aviso de contrato por vencer (Fase 13, 2). A los contratos activos con
 * `fin − hoy ≤ contractExpiryNoticeDays` que todavía no avisaron, una sola
 * vez (no todos los días del rango): al propietario y a la inmobiliaria.
 */
@Injectable()
export class ContractExpiryNoticeJob implements AutomationJob {
  readonly name = JobName.CONTRACT_EXPIRY_NOTICE

  constructor(
    private readonly contracts: ContractsFacade,
    private readonly tenants: TenantsFacade,
    private readonly owners: OwnersFacade,
    private readonly renters: RentersFacade,
    private readonly properties: PropertiesFacade,
    private readonly notifications: NotificationsService,
  ) {}

  async run(context: JobContext): Promise<JobOutcome> {
    const { contractExpiryNoticeDays } = await this.tenants.getContractSettings(
      context.tenantId!,
    )
    const expiring = await this.contracts.listExpiringWithin(
      contractExpiryNoticeDays,
      context.today,
    )
    if (expiring.length === 0) {
      return skipped(
        `Ningún contrato vence en los próximos ${contractExpiryNoticeDays} días`,
      )
    }

    const [owners, renters, properties] = await Promise.all([
      this.owners.contacts(expiring.map((c) => c.ownerId)),
      this.renters.describe(expiring.map((c) => c.renterId)),
      this.properties.describe(expiring.map((c) => c.propertyId)),
    ])
    const tally = new NoticeTally()
    for (const contract of expiring) {
      const owner = owners.get(contract.ownerId)
      const data = {
        propertyAddress: properties.get(contract.propertyId)?.address ?? null,
        renterName: renters.get(contract.renterId)?.fullName ?? null,
        ownerName: owner?.fullName ?? null,
        endDate: contract.endDate,
        daysLeft: contract.daysLeft,
      }
      const entity = { type: 'CONTRACT', id: contract.id }
      tally.add(
        await this.notifications.send({
          tenantId: context.tenantId!,
          type: 'CONTRACT_EXPIRING',
          recipient: {
            kind: NotificationRecipientKind.OWNER,
            id: contract.ownerId,
            email: owner?.email,
            phone: owner?.phone,
          },
          entity,
          dedupeKey: `CONTRACT_EXPIRING:${contract.id}:owner`,
          channels: [NotificationChannel.EMAIL],
          data,
        }),
      )
      await this.notifications.send({
        tenantId: context.tenantId!,
        type: 'CONTRACT_EXPIRING',
        recipient: { kind: NotificationRecipientKind.TENANT_STAFF },
        entity,
        dedupeKey: `CONTRACT_EXPIRING:${contract.id}:staff`,
        channels: [NotificationChannel.EMAIL],
        data,
      })
    }
    return tally.outcome('avisos de vencimiento')
  }
}
