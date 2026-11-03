import { PublicInquiry, PublicInquiryStatus } from './public-inquiry'

export interface NewPublicInquiry {
  name: string
  email: string
  phone: string
  message: string
  propertyId: string | null
  ip: string | null
}

/** Dentro del tenant del contexto; el filtro lo pone la extensión de Prisma. */
export abstract class PublicInquiryRepository {
  abstract create(data: NewPublicInquiry): Promise<PublicInquiry>

  abstract findById(id: string): Promise<PublicInquiry | null>

  /** Más nuevas primero. */
  abstract list(
    filter: { status?: PublicInquiryStatus; propertyId?: string },
    page: { skip: number; take: number },
  ): Promise<[PublicInquiry[], number]>

  abstract updateStatus(
    id: string,
    status: PublicInquiryStatus,
  ): Promise<PublicInquiry>

  /** Cuántas consultas llegaron desde esa IP, y con ese email, desde `since`. */
  abstract countSince(
    since: Date,
    by: { ip: string | null; email: string },
  ): Promise<{ byIp: number; byEmail: number }>
}
