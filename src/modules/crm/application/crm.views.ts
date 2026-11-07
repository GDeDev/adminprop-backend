import { Injectable } from '@nestjs/common'

import { UsersFacade } from '@/modules/auth/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { buildWhatsAppLink } from '@/shared/whatsapp/whatsapp'
import {
  Inquiry,
  InquiryActivity,
  InquiryActivityType,
  InquirySource,
  InquiryStage,
} from '../domain/inquiry'
import { InquiryPolicy } from '../domain/inquiry.policy'

export interface InquiryCardView {
  id: string
  name: string
  email: string | null
  phone: string | null
  /** Primeros 140 caracteres. */
  message: string
  stage: InquiryStage
  boardPosition: number
  source: InquirySource
  property: { id: string; address: string } | null
  assignedTo: { id: string; fullName: string } | null
  nextActionAt: string | null
  lastContactAt: Date | null
  createdAt: Date
  ageHours: number
  hasWhatsApp: boolean
}

export interface InquiryActivityView {
  id: string
  type: InquiryActivityType
  author: { id: string; fullName: string } | null
  payload: Record<string, unknown>
  createdAt: Date
}

export interface InquiryDetailView extends InquiryCardView {
  lostReason: string | null
  closedAt: Date | null
  contractId: string | null
  activities: InquiryActivityView[]
}

export interface PipelineView {
  columns: { stage: InquiryStage; total: number; cards: InquiryCardView[] }[]
}

/** Arma las tarjetas con una consulta por tipo de dato para todas (lote). */
@Injectable()
export class InquiryViews {
  constructor(
    private readonly properties: PropertiesFacade,
    private readonly users: UsersFacade,
  ) {}

  async cards(
    inquiries: Inquiry[],
    now: Date = new Date(),
  ): Promise<InquiryCardView[]> {
    const [properties, users] = await Promise.all([
      this.properties.describe(
        inquiries.flatMap((i) => (i.propertyId ? [i.propertyId] : [])),
      ),
      this.users.describe(
        inquiries.flatMap((i) => (i.assignedToId ? [i.assignedToId] : [])),
      ),
    ])
    return inquiries.map((inquiry) => ({
      id: inquiry.id,
      name: inquiry.name,
      email: inquiry.email,
      phone: inquiry.phone,
      message: InquiryPolicy.excerpt(inquiry.message),
      stage: inquiry.stage,
      boardPosition: inquiry.boardPosition,
      source: inquiry.source,
      // Si la propiedad ya no existe la tarjeta sigue: "consulta general".
      property:
        (inquiry.propertyId && properties.get(inquiry.propertyId)) || null,
      assignedTo:
        (inquiry.assignedToId && users.get(inquiry.assignedToId)) || null,
      nextActionAt: inquiry.nextActionAt,
      lastContactAt: inquiry.lastContactAt,
      createdAt: inquiry.createdAt,
      ageHours: InquiryPolicy.ageHours(inquiry.createdAt, now),
      hasWhatsApp: buildWhatsAppLink(inquiry.phone) !== null,
    }))
  }

  async card(inquiry: Inquiry): Promise<InquiryCardView> {
    return (await this.cards([inquiry]))[0]
  }

  async detail(
    inquiry: Inquiry,
    activities: InquiryActivity[],
  ): Promise<InquiryDetailView> {
    const [card] = await this.cards([inquiry])
    const authors = await this.users.describe(
      activities.flatMap((a) => (a.authorId ? [a.authorId] : [])),
    )
    return {
      ...card,
      message: inquiry.message,
      lostReason: inquiry.lostReason,
      closedAt: inquiry.closedAt,
      contractId: inquiry.contractId,
      activities: activities.map((activity) => ({
        id: activity.id,
        type: activity.type,
        author: (activity.authorId && authors.get(activity.authorId)) || null,
        payload: activity.payload,
        createdAt: activity.createdAt,
      })),
    }
  }
}
