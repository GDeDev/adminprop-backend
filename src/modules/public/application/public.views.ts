import { Injectable } from '@nestjs/common'

import { PropertiesFacade } from '@/modules/properties/public'
import {
  PublicInquiry,
  PublicInquirySource,
  PublicInquiryStatus,
} from '../domain/public-inquiry'

/** Una consulta para el personal (CRM de la Fase 23). Nunca lleva la IP. */
export interface PublicInquiryView {
  id: string
  name: string
  email: string
  phone: string
  message: string
  propertyId: string | null
  /** Null si la consulta no era sobre una propiedad o ya no existe. */
  property: { id: string; address: string } | null
  status: PublicInquiryStatus
  source: PublicInquirySource
  createdAt: Date
}

@Injectable()
export class PublicInquiryViews {
  constructor(private readonly properties: PropertiesFacade) {}

  /** Una sola consulta por las direcciones de todas. */
  async of(inquiries: PublicInquiry[]): Promise<PublicInquiryView[]> {
    const properties = await this.properties.describe(
      inquiries.flatMap((i) => (i.propertyId ? [i.propertyId] : [])),
    )
    return inquiries.map((inquiry) => ({
      id: inquiry.id,
      name: inquiry.name,
      email: inquiry.email,
      phone: inquiry.phone,
      message: inquiry.message,
      propertyId: inquiry.propertyId,
      property:
        (inquiry.propertyId && properties.get(inquiry.propertyId)) || null,
      status: inquiry.status,
      source: inquiry.source,
      createdAt: inquiry.createdAt,
    }))
  }
}
