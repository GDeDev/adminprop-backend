import { Injectable } from '@nestjs/common'

import { NotificationsService } from '@/platform/notifications/notifications.service'
import { RequestContext } from '@/shared/context/request-context'
import { createLogger } from '@/shared/logging/root-logger'
import { Inquiry } from '../domain/inquiry'

/**
 * Avisos internos del CRM. Nunca hacen fallar la operación que los dispara:
 * la asignación ya quedó guardada.
 */
@Injectable()
export class InquiryNotifier {
  private readonly logger = createLogger('InquiryNotifier')

  constructor(private readonly notifications: NotificationsService) {}

  /** A quien se la asignaron; nada si se la asignó a sí mismo (Fase 23, 4.1). */
  async assigned(inquiry: Inquiry): Promise<void> {
    const actor = RequestContext.userId
    if (!inquiry.assignedToId || inquiry.assignedToId === actor) return
    try {
      await this.notifications.notifyStaff({
        tenantId: RequestContext.tenantId as string,
        type: 'INQUIRY_ASSIGNED',
        title: `Te asignaron la consulta de ${inquiry.name}`,
        body: `La consulta de ${inquiry.name} quedó a tu cargo.`,
        dedupeKey: `INQUIRY_ASSIGNED:${inquiry.id}:${inquiry.assignedToId}:${Date.now()}`,
        entity: { type: 'Inquiry', id: inquiry.id },
        link: '/crm',
      })
    } catch (error) {
      this.logger.error(
        { err: error, inquiryId: inquiry.id },
        'No se pudo crear el aviso de asignación',
      )
    }
  }
}
