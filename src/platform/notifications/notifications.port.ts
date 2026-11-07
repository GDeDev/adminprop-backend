/**
 * Avisos a personas (Fase 13, 4). Los jobs de negocio piden "avisale esto a
 * este inquilino" y no saben cómo ni por dónde sale: hoy el adapter de consola
 * lo loguea; la Fase 14 cambia el adapter por Novu + Resend sin tocar a nadie.
 *
 * Clase abstracta y no interface para poder usarla como token de inyección.
 */
export abstract class NotificationsPort {
  abstract send(request: NotificationRequest): Promise<NotificationResult>
}

/** Coinciden con los enums de Prisma. */
export enum NotificationChannel {
  EMAIL = 'EMAIL',
  WHATSAPP_LINK = 'WHATSAPP_LINK',
  IN_APP = 'IN_APP',
}

export enum NotificationRecipientKind {
  RENTER = 'RENTER',
  OWNER = 'OWNER',
  TENANT_STAFF = 'TENANT_STAFF',
  INSURER = 'INSURER',
  EXTERNAL = 'EXTERNAL',
}

export enum NotificationStatus {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

/** Los tipos de aviso que emite el sistema (Fase 13, 2). */
export type NotificationType =
  | 'PAYMENT_REMINDER'
  | 'ARREARS_NOTICE'
  | 'INSURER_ALERT'
  | 'CONTRACT_EXPIRING'
  | 'POLICY_EXPIRING'
  | 'POLICY_EXPIRED'
  | 'SERVICE_OVERDUE'
  | 'RENT_UPDATE_PENDING'
  | 'INDEX_FETCH_FAILED'
  | 'INSTALLMENT_BASE_OUTDATED'
  | 'STATEMENT_PENDING'
  | 'JOB_FAILED'
  | 'DOCUMENT_FAILED'
  | 'PUBLIC_INQUIRY'
  | 'INQUIRY_FOLLOW_UP'
  | 'INQUIRY_ASSIGNED'
  | 'LISTING_CHANNEL_ERROR'
  | 'SETTLEMENT_CONFIRMED'
  | 'OWNER_STATEMENT_CLOSED'
  | 'PAYMENT_RECEIVED'
  | 'EMAIL_BOUNCED'
  | 'COMPARABLES_SOURCE_STALE'
  | 'NOTIFICATION_FAILED'

export interface NotificationRecipient {
  kind: NotificationRecipientKind
  /** Id del inquilino o propietario; ausente para el personal y la aseguradora. */
  id?: string
  email?: string | null
  phone?: string | null
}

export interface NotificationRequest {
  tenantId: string
  type: NotificationType
  recipient: NotificationRecipient
  /** A qué cuelga el aviso (cuota, contrato...). Ausente en los generales. */
  entity?: { type: string; id: string }
  /**
   * Identifica el aviso para no mandarlo dos veces ("PAYMENT_REMINDER:<cuota>").
   * Único por inmobiliaria.
   */
  dedupeKey: string
  channels: NotificationChannel[]
  /** Los campos que usa la plantilla; el texto final es de la Fase 14. */
  data: Record<string, unknown>
}

export interface NotificationResult {
  status:
    | NotificationStatus.SENT
    | NotificationStatus.SKIPPED
    | NotificationStatus.FAILED
  error?: string
}
