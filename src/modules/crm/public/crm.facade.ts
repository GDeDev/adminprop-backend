import { Injectable } from '@nestjs/common'

import {
  FollowUpReminderService,
  FollowUpSummary,
} from '../application/follow-up-reminder.service'
import { InquiryRegistrar } from '../application/inquiry-registrar'
import { PropertyViewsRecorder } from '../application/property-views-recorder'
import { InquiryRepository } from '../domain/crm.ports'
import { InquirySource } from '../domain/inquiry'

export type { FollowUpSummary }

export interface NewPortalInquiry {
  name: string
  email: string
  phone: string | null
  message: string
  propertyId: string | null
  ip: string | null
}

export interface RegisteredInquiry {
  id: string
  name: string
  email: string | null
  phone: string | null
  message: string
}

/**
 * Lo que otros módulos pueden pedirle al CRM. Dentro del tenant del contexto:
 * el portal público fija el tenant por el slug antes de llamar.
 */
@Injectable()
export class CrmFacade {
  constructor(
    private readonly registrar: InquiryRegistrar,
    private readonly inquiries: InquiryRepository,
    private readonly views: PropertyViewsRecorder,
    private readonly followUps: FollowUpReminderService,
  ) {}

  /** El job `crm.follow-up-reminder`: dentro del tenant del job. */
  sendFollowUpReminders(today: string): Promise<FollowUpSummary> {
    return this.followUps.run(today)
  }

  /** Una consulta del portal público: entra en `NEW`, sin asignar (A-85). */
  async registerPortalInquiry(
    input: NewPortalInquiry,
  ): Promise<RegisteredInquiry> {
    const { inquiry } = await this.registrar.register({
      ...input,
      source: InquirySource.PORTAL,
    })
    return {
      id: inquiry.id,
      name: inquiry.name,
      email: inquiry.email,
      phone: inquiry.phone,
      message: inquiry.message,
    }
  }

  /** Cuántas consultas llegaron desde esa IP, y con ese email, desde `since`. */
  countRecentInquiries(
    since: Date,
    by: { ip: string | null; email: string },
  ): Promise<{ byIp: number; byEmail: number }> {
    return this.inquiries.countSince(since, by)
  }

  /** Cuenta una vista de la ficha pública (A-83); nunca tira. */
  async recordPropertyView(
    propertyId: string,
    visitor: { ip: string | null; userAgent: string | null },
  ): Promise<void> {
    try {
      await this.views.record(propertyId, visitor)
    } catch {
      // Un contador no puede romper la ficha.
    }
  }
}
