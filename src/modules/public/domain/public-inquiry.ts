/** Estados de una consulta del portal. Coinciden con el enum de Prisma. */
export enum PublicInquiryStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  CLOSED = 'CLOSED',
}

export enum PublicInquirySource {
  PORTAL = 'PORTAL',
}

/** Cuántas consultas se aceptan por IP y por email en la ventana (A-106). */
export const INQUIRY_LIMIT = 5
export const INQUIRY_WINDOW_MINUTES = 60

export interface PublicInquiry {
  id: string
  name: string
  email: string
  phone: string
  message: string
  /** Id plano: la propiedad puede haberse borrado después. */
  propertyId: string | null
  status: PublicInquiryStatus
  source: PublicInquirySource
  createdAt: Date
  updatedAt: Date
}
