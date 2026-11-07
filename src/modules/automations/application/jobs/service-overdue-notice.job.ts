import { Injectable } from '@nestjs/common'

import { ContractsFacade } from '@/modules/contracts/public'
import { Catalog, MasterDataFacade } from '@/modules/master-data/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { ServicesFacade } from '@/modules/services/public'
import {
  NotificationChannel,
  NotificationRecipientKind,
} from '@/platform/notifications/notifications.port'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { JobName } from '../../domain/job-catalog'
import { AutomationJob, JobContext, JobOutcome } from '../job.types'
import { NoticeTally, skipped } from './notice-tally'

/** Desde cuántos días de vencido se avisa un servicio (RN-13). */
export const SERVICE_NOTICE_FROM_DAYS = 5

/**
 * Servicios vencidos (Fase 13, 2; RN-13). A partir del 5° día, al inquilino
 * del contrato (si la propiedad tiene uno) y a la inmobiliaria. Una vez por
 * servicio y vencimiento: si el servicio cambia de fecha de vencimiento,
 * vuelve a avisar.
 */
@Injectable()
export class ServiceOverdueNoticeJob implements AutomationJob {
  readonly name = JobName.SERVICE_OVERDUE_NOTICE

  constructor(
    private readonly services: ServicesFacade,
    private readonly contracts: ContractsFacade,
    private readonly renters: RentersFacade,
    private readonly properties: PropertiesFacade,
    private readonly masterData: MasterDataFacade,
    private readonly notifications: NotificationsService,
  ) {}

  async run(context: JobContext): Promise<JobOutcome> {
    const overdue = (await this.services.listOverdue(context.today)).filter(
      (service) => service.daysOverdue >= SERVICE_NOTICE_FROM_DAYS,
    )
    if (overdue.length === 0)
      return skipped('Ningún servicio vencido hace 5 días o más')

    // El inquilino es el del contrato al que se vinculó el servicio; si no se
    // vinculó, el de la propiedad si hoy tiene un contrato activo.
    // Dos consultas en total, no una por servicio (B-P6).
    const { byContract, byActiveProperty } = await this.contracts.renterIds({
      contractIds: overdue.flatMap((s) => (s.contractId ? [s.contractId] : [])),
      activePropertyIds: overdue
        .filter((s) => !s.contractId)
        .map((s) => s.propertyId),
    })
    const renterByService = new Map<string, string>()
    for (const service of overdue) {
      const renterId = service.contractId
        ? byContract.get(service.contractId)
        : byActiveProperty.get(service.propertyId)
      if (renterId) renterByService.set(service.id, renterId)
    }
    const [renters, properties, serviceTypes] = await Promise.all([
      this.renters.contacts([...renterByService.values()]),
      this.properties.describe(overdue.map((s) => s.propertyId)),
      this.masterData.describeCatalog(
        Catalog.SERVICE_TYPES,
        overdue.map((s) => s.serviceTypeId),
      ),
    ])

    const tally = new NoticeTally()
    for (const service of overdue) {
      const renterId = renterByService.get(service.id)
      const renter = renterId ? renters.get(renterId) : undefined
      const data = {
        serviceName: serviceTypes.get(service.serviceTypeId)?.name ?? null,
        propertyAddress: properties.get(service.propertyId)?.address ?? null,
        renterName: renter?.fullName ?? null,
        dueDate: service.dueDate,
        daysOverdue: service.daysOverdue,
      }
      const entity = { type: 'PROPERTY_SERVICE', id: service.id }
      if (renter) {
        tally.add(
          await this.notifications.send({
            tenantId: context.tenantId!,
            type: 'SERVICE_OVERDUE',
            recipient: {
              kind: NotificationRecipientKind.RENTER,
              id: renter.id,
              email: renter.email,
              phone: renter.phone,
            },
            entity,
            dedupeKey: `SERVICE_OVERDUE:${service.id}:${service.dueDate}:renter`,
            channels: [
              NotificationChannel.EMAIL,
              NotificationChannel.WHATSAPP_LINK,
            ],
            data,
          }),
        )
      }
      const staff = await this.notifications.send({
        tenantId: context.tenantId!,
        type: 'SERVICE_OVERDUE',
        recipient: { kind: NotificationRecipientKind.TENANT_STAFF },
        entity,
        dedupeKey: `SERVICE_OVERDUE:${service.id}:${service.dueDate}:staff`,
        channels: [NotificationChannel.EMAIL],
        data,
      })
      // Sin inquilino, el aviso a la inmobiliaria es el único y es el que cuenta.
      if (!renter) tally.add(staff)
    }
    return tally.outcome('avisos de servicio')
  }
}
