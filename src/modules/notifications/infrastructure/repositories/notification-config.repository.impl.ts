import { Injectable } from '@nestjs/common'

import { RequestContext } from '@/shared/context/request-context'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  ChannelName,
  NotificationTypeName,
} from '../../domain/notification-catalog'
import {
  NotificationConfigRepository,
  TemplateOverrideRow,
  TenantSettingRow,
  UserPreferenceRow,
  WhatsAppOverrideRow,
} from '../../domain/notification.ports'

@Injectable()
export class NotificationConfigRepositoryImpl extends NotificationConfigRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async listSettings(): Promise<TenantSettingRow[]> {
    const rows = await this.prisma.db.notificationSetting.findMany({
      orderBy: { type: 'asc' },
    })
    return rows.map((row) => ({
      type: row.type,
      enabled: row.enabled,
      channels: row.channels as ChannelName[],
    }))
  }

  async upsertSetting(row: TenantSettingRow): Promise<void> {
    const tenantId = this.tenantId()
    // find + create/update y no `upsert`: la auditoría sólo ve create, update y
    // delete, y estos cambios tienen que quedar en el historial.
    const existing = await this.prisma.db.notificationSetting.findFirst({
      where: { type: row.type },
    })
    if (existing) {
      await this.prisma.db.notificationSetting.update({
        where: { id: existing.id },
        data: { enabled: row.enabled, channels: row.channels },
      })
    } else {
      await this.prisma.db.notificationSetting.create({
        data: {
          tenantId,
          type: row.type,
          enabled: row.enabled,
          channels: row.channels,
        },
      })
    }
  }

  async listTemplates(): Promise<TemplateOverrideRow[]> {
    const rows = await this.prisma.db.notificationTemplate.findMany({
      orderBy: { key: 'asc' },
    })
    return rows.map((row) => ({
      key: row.key,
      subject: row.subject,
      bodyText: row.bodyText,
      updatedAt: row.updatedAt,
    }))
  }

  async findTemplate(key: string): Promise<TemplateOverrideRow | null> {
    const row = await this.prisma.db.notificationTemplate.findFirst({
      where: { key },
    })
    return row
      ? {
          key: row.key,
          subject: row.subject,
          bodyText: row.bodyText,
          updatedAt: row.updatedAt,
        }
      : null
  }

  async upsertTemplate(
    key: string,
    subject: string,
    bodyText: string,
    userId: string | null,
  ): Promise<TemplateOverrideRow> {
    const tenantId = this.tenantId()
    const existing = await this.prisma.db.notificationTemplate.findFirst({
      where: { key },
    })
    const row = existing
      ? await this.prisma.db.notificationTemplate.update({
          where: { id: existing.id },
          data: { subject, bodyText, updatedById: userId },
        })
      : await this.prisma.db.notificationTemplate.create({
          data: { tenantId, key, subject, bodyText, updatedById: userId },
        })
    return {
      key: row.key,
      subject: row.subject,
      bodyText: row.bodyText,
      updatedAt: row.updatedAt,
    }
  }

  async deleteTemplate(key: string): Promise<void> {
    const existing = await this.prisma.db.notificationTemplate.findFirst({
      where: { key },
    })
    if (existing) {
      await this.prisma.db.notificationTemplate.delete({
        where: { id: existing.id },
      })
    }
  }

  async listUserPreferences(userId: string): Promise<UserPreferenceRow[]> {
    const rows = await this.prisma.db.notificationUserPreference.findMany({
      where: { userId },
    })
    return rows.map((row) => ({
      type: row.type,
      emailEnabled: row.emailEnabled,
      inAppEnabled: row.inAppEnabled,
    }))
  }

  async findUserPreference(
    userId: string,
    type: string,
  ): Promise<UserPreferenceRow | null> {
    const row = await this.prisma.db.notificationUserPreference.findFirst({
      where: { userId, type },
    })
    return row
      ? {
          type: row.type,
          emailEnabled: row.emailEnabled,
          inAppEnabled: row.inAppEnabled,
        }
      : null
  }

  async upsertUserPreference(
    userId: string,
    row: UserPreferenceRow,
  ): Promise<void> {
    const tenantId = this.tenantId()
    await this.prisma.db.notificationUserPreference.upsert({
      where: { tenantId_userId_type: { tenantId, userId, type: row.type } },
      create: {
        tenantId,
        userId,
        type: row.type,
        emailEnabled: row.emailEnabled,
        inAppEnabled: row.inAppEnabled,
      },
      update: {
        emailEnabled: row.emailEnabled,
        inAppEnabled: row.inAppEnabled,
      },
    })
  }

  async typesWithInAppOptOut(userId: string): Promise<NotificationTypeName[]> {
    const rows = await this.prisma.db.notificationUserPreference.findMany({
      where: { userId, inAppEnabled: false },
      select: { type: true },
    })
    return rows.map((row) => row.type as NotificationTypeName)
  }

  async listWhatsApp(): Promise<WhatsAppOverrideRow[]> {
    const rows = await this.prisma.db.whatsAppTemplate.findMany({
      orderBy: { key: 'asc' },
    })
    return rows.map((row) => ({ key: row.key, body: row.body }))
  }

  async upsertWhatsApp(
    key: string,
    title: string,
    body: string,
  ): Promise<void> {
    const tenantId = this.tenantId()
    const existing = await this.prisma.db.whatsAppTemplate.findFirst({
      where: { key },
    })
    if (existing) {
      await this.prisma.db.whatsAppTemplate.update({
        where: { id: existing.id },
        data: { title, body },
      })
    } else {
      await this.prisma.db.whatsAppTemplate.create({
        data: { tenantId, key, title, body },
      })
    }
  }

  private tenantId(): string {
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Operación de notificaciones sin tenant')
    return tenantId
  }
}
