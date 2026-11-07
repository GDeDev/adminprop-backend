import { Injectable } from '@nestjs/common'
import {
  NotificationChannel,
  NotificationLog,
  NotificationRecipientKind,
  Prisma,
} from '@prisma/client'

import {
  AlertRepository,
  InternalAlert,
  PageArgs,
} from '@/modules/automations/domain/automations.ports'
import { PrismaService } from '@/shared/prisma/prisma.service'

/**
 * Los avisos internos son las filas de `notification_log` con canal `IN_APP`
 * para el personal. El filtro de tenant lo pone la extensión de Prisma.
 */
@Injectable()
export class AlertRepositoryImpl extends AlertRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async list(
    filter: { unreadOnly: boolean; since: Date; types: string[] },
    page: PageArgs,
  ): Promise<[InternalAlert[], number]> {
    const where: Prisma.NotificationLogWhereInput = {
      ...baseWhere(filter.types),
      createdAt: { gte: filter.since },
      ...(filter.unreadOnly ? { readAt: null } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.db.notificationLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...page,
      }),
      this.prisma.db.notificationLog.count({ where }),
    ])
    return [rows.map(toDomain), total]
  }

  async markRead(id: string, at: Date): Promise<InternalAlert | null> {
    const row = await this.prisma.db.notificationLog.findFirst({
      where: { id, recipientKind: NotificationRecipientKind.TENANT_STAFF },
    })
    if (!row) return null
    if (row.readAt) return toDomain(row)
    return toDomain(
      await this.prisma.db.notificationLog.update({
        where: { id },
        data: { readAt: at },
      }),
    )
  }

  async markAllRead(types: string[], at: Date): Promise<number> {
    const result = await this.prisma.db.notificationLog.updateMany({
      where: { ...baseWhere(types), readAt: null },
      data: { readAt: at },
    })
    return result.count
  }
}

function baseWhere(types: string[]): Prisma.NotificationLogWhereInput {
  return {
    channel: NotificationChannel.IN_APP,
    recipientKind: NotificationRecipientKind.TENANT_STAFF,
    type: { in: types },
  }
}

function toDomain(row: NotificationLog): InternalAlert {
  const payload = (row.payload ?? {}) as Record<string, unknown>
  const text = (key: string) =>
    typeof payload[key] === 'string' ? (payload[key] as string) : null
  return {
    id: row.id,
    type: row.type,
    title: text('title') ?? row.type,
    body: text('body') ?? '',
    entityType: row.entityType,
    entityId: row.entityId,
    link: text('link'),
    createdAt: row.createdAt,
    readAt: row.readAt,
  }
}
