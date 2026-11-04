import { Injectable } from '@nestjs/common'

import { UsersFacade } from '@/modules/auth/public'
import { RequestContext } from '@/shared/context/request-context'
import {
  AssigneeInvalidException,
  InquiryContactRequiredException,
} from '../domain/crm.exceptions'
import {
  InquiryActivityRepository,
  InquiryRepository,
} from '../domain/crm.ports'
import {
  Inquiry,
  InquiryActivityType,
  InquirySource,
  InquiryStage,
} from '../domain/inquiry'
import { InquiryPolicy, POSITION_STEP } from '../domain/inquiry.policy'

export interface RegisterInquiryInput {
  name: string
  email?: string | null
  phone?: string | null
  message?: string | null
  propertyId?: string | null
  source: InquirySource
  assignedToId?: string | null
  externalId?: string | null
  ip?: string | null
  createdAt?: Date
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Único camino por el que nace una consulta (portal, carga manual o sincronía
 * con un portal externo): normaliza, ubica la tarjeta arriba de `NEW` y deja
 * la actividad `CREATED`. Si trae `externalId` y ya existe, devuelve la
 * existente sin duplicar.
 */
@Injectable()
export class InquiryRegistrar {
  constructor(
    private readonly inquiries: InquiryRepository,
    private readonly activities: InquiryActivityRepository,
    private readonly users: UsersFacade,
  ) {}

  async register(
    input: RegisterInquiryInput,
  ): Promise<{ inquiry: Inquiry; created: boolean }> {
    const email = input.email?.trim().toLowerCase() || null
    const phone = input.phone ? oneLine(input.phone) || null : null
    if (!InquiryPolicy.hasContact(email, phone)) {
      throw new InquiryContactRequiredException()
    }

    if (input.externalId) {
      const existing = await this.inquiries.findByExternalId(
        input.source,
        input.externalId,
      )
      if (existing) return { inquiry: existing, created: false }
    }

    if (input.assignedToId) await this.assertAssignable(input.assignedToId)

    const min = await this.inquiries.minPosition(InquiryStage.NEW)
    const inquiry = await this.inquiries.create({
      name: oneLine(input.name),
      email,
      phone,
      message: (input.message ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      propertyId: input.propertyId ?? null,
      source: input.source,
      assignedToId: input.assignedToId ?? null,
      externalId: input.externalId ?? null,
      ip: input.ip ?? null,
      boardPosition: min === null ? POSITION_STEP : min - POSITION_STEP,
      createdAt: input.createdAt,
    })
    await this.activities.add({
      inquiryId: inquiry.id,
      type: InquiryActivityType.CREATED,
      authorId: RequestContext.userId ?? null,
      payload: { source: inquiry.source },
    })
    return { inquiry, created: true }
  }

  /** Sólo personal activo de esta inmobiliaria (`ASSIGNEE_INVALID` si no). */
  async assertAssignable(userId: string): Promise<void> {
    const staff = await this.users.listStaffContacts()
    if (!staff.some((contact) => contact.userId === userId)) {
      throw new AssigneeInvalidException(userId)
    }
  }
}
