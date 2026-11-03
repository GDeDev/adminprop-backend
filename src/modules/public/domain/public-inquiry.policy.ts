import { INQUIRY_LIMIT } from './public-inquiry'

export interface InquiryContact {
  name: string
  email: string
  phone: string
  message: string
}

/** Reglas puras de las consultas del portal (Fase 22). */
export const PublicInquiryPolicy = {
  /**
   * Honeypot: el campo `website` está oculto en el formulario real, así que
   * una persona lo manda vacío. Si trae algo, es un bot.
   */
  isBot(website: string | null | undefined): boolean {
    return Boolean(website?.trim())
  },

  /**
   * Limpia lo que escribió el público: espacios de más y saltos de línea en
   * los datos de una línea (van al asunto del email). El mensaje conserva los
   * saltos de línea. El email se guarda en minúsculas para contar el límite.
   */
  normalize(contact: InquiryContact): InquiryContact {
    const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
    return {
      name: oneLine(contact.name),
      email: contact.email.trim().toLowerCase(),
      phone: oneLine(contact.phone),
      message: contact.message
        .replace(/\r\n?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    }
  },

  /** Con `INQUIRY_LIMIT` consultas en la ventana (por IP o por email) ya no entra otra. */
  isOverLimit(recentByIp: number, recentByEmail: number): boolean {
    return recentByIp >= INQUIRY_LIMIT || recentByEmail >= INQUIRY_LIMIT
  },
}
