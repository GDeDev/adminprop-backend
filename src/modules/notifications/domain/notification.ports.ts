import {
  ChannelName,
  NotificationTypeName,
  SkipReasonName,
} from './notification-catalog'

/** Coinciden con los enums de Prisma. */
export type RecipientKindName =
  'TENANT_STAFF' | 'RENTER' | 'OWNER' | 'INSURER' | 'EXTERNAL'

export type StatusName = 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED'

export type EmailEventTypeName =
  | 'SENT'
  | 'DELIVERED'
  | 'OPENED'
  | 'CLICKED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'DELAYED'

/** Una fila de `notification_log`, como la ve el módulo. */
export interface NotificationRow {
  id: string
  tenantId: string
  type: string
  templateKey: string | null
  channel: ChannelName
  status: StatusName
  skipReason: SkipReasonName | null
  recipientKind: RecipientKindName
  recipientId: string | null
  recipientEmail: string | null
  entityType: string | null
  entityId: string | null
  dedupeKey: string
  subject: string | null
  attempts: number
  nextAttemptAt: Date | null
  error: string | null
  sentAt: Date | null
  readAt: Date | null
  providerMessageId: string | null
  payload: Record<string, unknown>
  createdAt: Date
}

export interface NewNotification {
  type: string
  templateKey?: string | null
  channel: ChannelName
  status: StatusName
  skipReason?: SkipReasonName | null
  recipientKind: RecipientKindName
  recipientId?: string | null
  recipientEmail?: string | null
  entityType?: string | null
  entityId?: string | null
  dedupeKey: string
  subject?: string | null
  sentAt?: Date | null
  payload: Record<string, unknown>
}

export interface NotificationPatch {
  templateKey?: string | null
  channel?: ChannelName
  status?: StatusName
  skipReason?: SkipReasonName | null
  recipientEmail?: string | null
  subject?: string | null
  attempts?: number
  nextAttemptAt?: Date | null
  error?: string | null
  sentAt?: Date | null
  providerMessageId?: string | null
  payload?: Record<string, unknown>
}

export interface NotificationFilter {
  type?: string
  status?: StatusName
  channel?: ChannelName
  recipientKind?: RecipientKindName
  entityId?: string
  from?: Date
  to?: Date
}

export interface PageArgs {
  skip: number
  take: number
}

/** Lo que el webhook dejó de cada mensaje, para el historial. */
export interface EmailEventRow {
  id: string
  notificationId: string | null
  type: EmailEventTypeName
  occurredAt: Date
}

export interface NewEmailEvent {
  tenantId: string
  notificationId: string | null
  providerMessageId: string
  type: EmailEventTypeName
  recipientEmail: string | null
  payloadRaw: unknown
  occurredAt: Date
}

/** Puerto del historial (`notification_log`). Corre dentro del tenant del contexto. */
export abstract class NotificationLogRepository {
  abstract findByDedupeKey(dedupeKey: string): Promise<NotificationRow | null>
  abstract findById(id: string): Promise<NotificationRow | null>
  /** `null` si la clave ya existe (carrera entre dos procesos). */
  abstract create(data: NewNotification): Promise<NotificationRow | null>
  abstract update(
    id: string,
    patch: NotificationPatch,
  ): Promise<NotificationRow>
  /** Más nuevas primero. */
  abstract list(
    filter: NotificationFilter,
    page: PageArgs,
  ): Promise<[NotificationRow[], number]>
  /** Ids de las fallidas que cumplen el filtro, más viejas primero. */
  abstract failedIds(
    filter: Pick<NotificationFilter, 'type' | 'from' | 'to'>,
  ): Promise<string[]>
  /**
   * Busca por id del proveedor **entre todas las inmobiliarias**: el webhook
   * no sabe de qué tenant es el mensaje hasta encontrarlo.
   */
  abstract findByProviderMessageIdAcrossTenants(
    providerMessageId: string,
  ): Promise<NotificationRow | null>
}

export abstract class EmailEventRepository {
  /** Inserta; `false` si ya existía (evento repetido). */
  abstract insertIfNew(event: NewEmailEvent): Promise<boolean>
  abstract listByNotificationIds(ids: string[]): Promise<EmailEventRow[]>
}

export interface TenantSettingRow {
  type: string
  enabled: boolean
  channels: ChannelName[]
}

export interface TemplateOverrideRow {
  key: string
  subject: string
  bodyText: string
  updatedAt: Date
}

export interface UserPreferenceRow {
  type: string
  emailEnabled: boolean
  inAppEnabled: boolean
}

export interface WhatsAppOverrideRow {
  key: string
  body: string
}

/** Configuración por inmobiliaria: tipos, plantillas, preferencias y WhatsApp. */
export abstract class NotificationConfigRepository {
  abstract listSettings(): Promise<TenantSettingRow[]>
  abstract upsertSetting(row: TenantSettingRow): Promise<void>

  abstract listTemplates(): Promise<TemplateOverrideRow[]>
  abstract findTemplate(key: string): Promise<TemplateOverrideRow | null>
  abstract upsertTemplate(
    key: string,
    subject: string,
    bodyText: string,
    userId: string | null,
  ): Promise<TemplateOverrideRow>
  abstract deleteTemplate(key: string): Promise<void>

  abstract listUserPreferences(userId: string): Promise<UserPreferenceRow[]>
  abstract findUserPreference(
    userId: string,
    type: string,
  ): Promise<UserPreferenceRow | null>
  abstract upsertUserPreference(
    userId: string,
    row: UserPreferenceRow,
  ): Promise<void>
  /** Los tipos en que ese usuario apagó el aviso interno. */
  abstract typesWithInAppOptOut(userId: string): Promise<NotificationTypeName[]>

  abstract listWhatsApp(): Promise<WhatsAppOverrideRow[]>
  abstract upsertWhatsApp(
    key: string,
    title: string,
    body: string,
  ): Promise<void>
}
