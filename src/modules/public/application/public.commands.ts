import { PublicInquiryStatus } from '../domain/public-inquiry'

export interface PublicContactInput {
  name: string
  email: string
  phone: string
  message: string
  propertyId: string | null
  /** Honeypot: vacío si lo manda una persona. */
  website: string
}

/** El formulario de contacto del portal (`POST /public/:slug/contact`). */
export class SubmitPublicInquiryCommand {
  constructor(
    public readonly slug: string,
    public readonly input: PublicContactInput,
    public readonly ip: string | null,
  ) {}
}

export class UpdatePublicInquiryStatusCommand {
  constructor(
    public readonly id: string,
    public readonly status: PublicInquiryStatus,
  ) {}
}
