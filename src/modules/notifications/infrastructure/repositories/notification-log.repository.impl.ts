import { Injectable } from '@nestjs/common'
import { NotificationLog, Prisma } from '@prisma/client'

import { ChannelName, SkipReasonName } from '../../domain/notification-catalog'
import {
  EmailEventRepository,
  EmailEventRow,
  EmailEventTypeName,
  NewEmailEvent,
  NewNotification,
  NotificationFilter,
  NotificationLogRepository,
  NotificationPatch,
  NotificationRow,
  PageArgs,
  RecipientKindName,
  StatusName,
} from '../../domain/notification.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'

function toDomain(row: NotificationLog): NotificationRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    templateKey: row.templateKey,
    channel: row.channel as ChannelName,
    status: row.status as StatusName,
    skipReason: row.skipReason as SkipReasonName | null,
    recipientKind: row.recipientKind as RecipientKindName,
    recipientId: row.recipientId,
    recipientEmail: row.recipientEmail,
    entityType: row.entityType,
    entityId: row.entityId,
    dedupeKey: row.dedupeKey,
    subject: row.subject,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    error: row.error,
    sentAt: row.sentAt,
    readAt: row.readAt,
    providerMessageId: row.providerMessageId,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
  }
}

function where(filter: NotificationFilter): Prisma.NotificationLogWhereInput {
  return {
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.channel ? { channel: filter.channel } : {}),
    ...(filter.recipientKind ? { recipientKind: filter.recipientKind } : {}),
    ...(filter.entityId ? { entityId: filter.entityId } : {}),
    ...(filter.from || filter.to
      ? { createdAt: { gte: filter.from, lte: filter.to } }
      : {}),
  }
}

@Injectable()
export class NotificationLogRepositoryImpl extends NotificationLogRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async findByDedupeKey(dedupeKey: string): Promise<NotificationRow | null> {
    const row = await this.prisma.db.notificationLog.findFirst({
      where: { dedupeKey },
    })
    return row ? toDomain(row) : null
  }

  async findById(id: string): Promise<NotificationRow | null> {
    const row = await this.prisma.db.notificationLog.findFirst({
      where: { id },
    })
    return row ? toDomain(row) : null
  }

  async create(data: NewNotification): Promise<NotificationRow | null> {
    try {
      const row = await this.prisma.db.notificationLog.create({
        data: {
          ...data,
          payload: data.payload as Prisma.InputJsonValue,
        } as Prisma.NotificationLogUncheckedCreateInput,
      })
      return toDomain(row)
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null
      }
      throw error
    }
  }

  async update(id: string, patch: NotificationPatch): Promise<NotificationRow> {
    const row = await this.prisma.db.notificationLog.update({
      where: { id },
      data: {
        ...patch,
        payload: patch.payload as Prisma.InputJsonValue | undefined,
      },
    })
    return toDomain(row)
  }

  async list(
    filter: NotificationFilter,
    page: PageArgs,
  ): Promise<[NotificationRow[], number]> {
    // El historial muestra envíos, no la campana: las filas IN_APP del
    // personal viven en `/automations/alerts`.
    const clause: Prisma.NotificationLogWhereInput = {
      AND: [
        where(filter),
        {
          NOT: { channel: 'IN_APP', recipientKind: 'TENANT_STAFF' },
        },
      ],
    }
    const [rows, total] = await Promise.all([
      this.prisma.db.notificationLog.findMany({
        where: clause,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...page,
      }),
      this.prisma.db.notificationLog.count({ where: clause }),
    ])
    return [rows.map(toDomain), total]
  }

  async failedIds(
    filter: Pick<NotificationFilter, 'type' | 'from' | 'to'>,
  ): Promise<string[]> {
    const rows = await this.prisma.db.notificationLog.findMany({
      where: { ...where(filter), status: 'FAILED' },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map((row) => row.id)
  }

  async findByProviderMessageIdAcrossTenants(
    providerMessageId: string,
  ): Promise<NotificationRow | null> {
    // Entre tenants a propósito: el webhook llega sin contexto y el id del
    // proveedor es el único dato que lo une con una inmobiliaria.
    const row = await this.prisma.unscoped.notificationLog.findFirst({
      where: { providerMessageId },
    })
    return row ? toDomain(row) : null
  }
}

@Injectable()
export class EmailEventRepositoryImpl extends EmailEventRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async insertIfNew(event: NewEmailEvent): Promise<boolean> {
    try {
      await this.prisma.db.emailEvent.create({
        data: {
          tenantId: event.tenantId,
          notificationId: event.notificationId,
          providerMessageId: event.providerMessageId,
          eventType: event.type,
          recipientEmail: event.recipientEmail,
          payloadRaw: event.payloadRaw as Prisma.InputJsonValue,
          occurredAt: event.occurredAt,
        },
      })
      return true
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false
      }
      throw error
    }
  }

  async listByNotificationIds(ids: string[]): Promise<EmailEventRow[]> {
    if (ids.length === 0) return []
    const rows = await this.prisma.db.emailEvent.findMany({
      where: { notificationId: { in: ids } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      notificationId: row.notificationId,
      type: row.eventType as EmailEventTypeName,
      occurredAt: row.occurredAt,
    }))
  }
}
