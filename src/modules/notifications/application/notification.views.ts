import { findCatalogEntry } from '../domain/notification-catalog'
import {
  EmailEventRow,
  EmailEventTypeName,
  NotificationRow,
} from '../domain/notification.ports'
import { recipientNameOf } from './notification-variables'

/** `NotificationLogItem` del contrato (`shared-types/notifications.ts`). */
export interface NotificationLogItemView {
  id: string
  type: string
  templateKey: string | null
  channel: string
  status: string
  skipReason: string | null
  recipientKind: string
  recipientLabel: string
  recipientEmail: string | null
  entityType: string | null
  entityId: string | null
  attempts: number
  nextAttemptAt: Date | null
  lastError: string | null
  sentAt: Date | null
  deliveredAt: Date | null
  openedAt: Date | null
  bouncedAt: Date | null
  createdAt: Date
}

export interface NotificationDetailView extends NotificationLogItemView {
  subject: string | null
  bodyText: string | null
  events: { id: string; type: string; occurredAt: Date }[]
  canResend: boolean
}

const STAFF_LABEL = 'Personal de la inmobiliaria'

function firstOf(
  events: EmailEventRow[],
  ...types: EmailEventTypeName[]
): Date | null {
  const found = events
    .filter((event) => types.includes(event.type))
    .map((event) => event.occurredAt)
    .sort((a, b) => a.getTime() - b.getTime())
  return found[0] ?? null
}

export function toLogItem(
  row: NotificationRow,
  events: EmailEventRow[],
): NotificationLogItemView {
  return {
    id: row.id,
    type: row.type,
    templateKey: row.templateKey,
    channel: row.channel,
    status: row.status,
    skipReason: row.skipReason,
    recipientKind: row.recipientKind,
    recipientLabel:
      recipientNameOf(row.recipientKind, row.payload) ??
      row.recipientEmail ??
      STAFF_LABEL,
    recipientEmail: row.recipientEmail,
    entityType: row.entityType,
    entityId: row.entityId,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    lastError: row.error,
    sentAt: row.sentAt,
    deliveredAt: firstOf(events, 'DELIVERED'),
    openedAt: firstOf(events, 'OPENED'),
    bouncedAt: firstOf(events, 'BOUNCED', 'COMPLAINED'),
    createdAt: row.createdAt,
  }
}

export function toDetail(
  row: NotificationRow,
  events: EmailEventRow[],
): NotificationDetailView {
  return {
    ...toLogItem(row, events),
    subject: row.subject,
    bodyText:
      typeof row.payload.bodyText === 'string' ? row.payload.bodyText : null,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
    })),
    canResend: canResend(row),
  }
}

/** Sólo una entrega que falló, y a un email que se pueda volver a intentar. */
export function canResend(row: NotificationRow): boolean {
  return (
    row.status === 'FAILED' &&
    row.channel === 'EMAIL' &&
    Boolean(row.recipientEmail) &&
    Boolean(findCatalogEntry(row.type))
  )
}
