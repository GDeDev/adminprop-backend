import { Injectable } from '@nestjs/common'

import { UsersFacade } from '@/modules/auth/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { NotificationsService } from '@/platform/notifications/notifications.service'
import { RequestContext } from '@/shared/context/request-context'
import { errorMessage } from '@/shared/core/error-message'
import { createLogger } from '@/shared/logging/root-logger'
import { InquiryRepository } from '../domain/crm.ports'

export interface FollowUpSummary {
  /** Consultas abiertas con el seguimiento vencido. */
  due: number
  /** Avisos nuevos creados (los que ya tenían aviso para esa fecha no cuentan). */
  notified: number
  failed: number
}

/**
 * Job `crm.follow-up-reminder` (Fase 23, 4.1): avisa las consultas abiertas
 * cuya fecha de seguimiento ya llegó. El aviso va a la campana del personal;
 * si la consulta tiene responsable el texto lo nombra. La clave
 * `INQUIRY_FOLLOW_UP:<consulta>:<fecha de seguimiento>` hace que correrlo dos
 * veces no repita el aviso (A-152). Dentro del tenant del contexto.
 */
@Injectable()
export class FollowUpReminderService {
  private readonly logger = createLogger('FollowUpReminder')

  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly notifications: NotificationsService,
    private readonly properties: PropertiesFacade,
    private readonly users: UsersFacade,
  ) {}

  async run(today: string): Promise<FollowUpSummary> {
    const due = await this.inquiries.listFollowUpsDue(today)
    if (due.length === 0) return { due: 0, notified: 0, failed: 0 }

    const [addresses, owners] = await Promise.all([
      this.properties.describe(
        due.flatMap((i) => (i.propertyId ? [i.propertyId] : [])),
      ),
      this.users.describe(
        due.flatMap((i) => (i.assignedToId ? [i.assignedToId] : [])),
      ),
    ])

    const tenantId = RequestContext.tenantId as string
    let notified = 0
    let failed = 0
    for (const inquiry of due) {
      const about = inquiry.propertyId
        ? ` sobre ${addresses.get(inquiry.propertyId)?.address ?? 'una propiedad'}`
        : ''
      const owner = inquiry.assignedToId
        ? owners.get(inquiry.assignedToId)?.fullName
        : null
      try {
        const outcome = await this.notifications.notifyStaff({
          tenantId,
          type: 'INQUIRY_FOLLOW_UP',
          title: `Seguimiento pendiente: ${inquiry.name}`,
          body: owner
            ? `${owner} tenía que retomar la consulta de ${inquiry.name}${about} el ${inquiry.nextActionAt}.`
            : `La consulta de ${inquiry.name}${about} no tiene responsable y su seguimiento era el ${inquiry.nextActionAt}.`,
          dedupeKey: `INQUIRY_FOLLOW_UP:${inquiry.id}:${inquiry.nextActionAt}`,
          entity: { type: 'Inquiry', id: inquiry.id },
          link: '/crm',
        })
        if (outcome === 'SENT') notified += 1
        if (outcome === 'FAILED') failed += 1
      } catch (error) {
        failed += 1
        this.logger.error(
          { err: error, inquiryId: inquiry.id },
          `No se pudo avisar el seguimiento: ${errorMessage(error)}`,
        )
      }
    }
    return { due: due.length, notified, failed }
  }
}
