import {
  CommandHandler,
  ICommandHandler,
  IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs'

import { RequestContext } from '@/shared/context/request-context'
import {
  ChannelName,
  findCatalogEntry,
  NOTIFICATION_CATALOG,
  NotificationTypeName,
} from '../domain/notification-catalog'
import {
  NotificationChannelNotAvailableException,
  NotificationMandatoryException,
  NotificationTypeUnknownException,
  TemplateNotFoundException,
  TemplateUnknownVariableException,
  UserWithoutEmailException,
} from '../domain/notification.exceptions'
import {
  NotificationConfigRepository,
  NotificationLogRepository,
} from '../domain/notification.ports'
import { renderEmail } from '../domain/notification-templates'
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  findDefaultWhatsAppTemplate,
} from '../domain/whatsapp-templates'
import {
  GetMyPreferencesQuery,
  ListNotificationSettingsQuery,
  ListNotificationTemplatesQuery,
  ListWhatsAppTemplatesQuery,
  PreviewTemplateQuery,
  ResetNotificationTemplateCommand,
  SendTemplateTestCommand,
  UpdateMyPreferencesCommand,
  UpdateNotificationSettingsCommand,
  UpdateNotificationTemplateCommand,
  UpdateWhatsAppTemplateCommand,
} from './notification.commands'
import { NotificationDeliveryService } from './notification-delivery.service'
import { ResolvedTemplate, TemplateService } from './template.service'

// ------------------------------------------------------------------- Vistas

export interface NotificationTypeSettingView {
  type: string
  title: string
  description: string
  audience: string
  enabled: boolean
  channels: ChannelName[]
  availableChannels: ChannelName[]
  mandatory: boolean
}

export interface NotificationTemplateView {
  key: string
  type: string
  channel: 'EMAIL'
  title: string
  subject: string
  bodyText: string
  variables: { name: string; label: string; example: string }[]
  isCustomized: boolean
  updatedAt: Date | null
}

export interface MyPreferencesView {
  items: {
    type: string
    title: string
    emailEnabled: boolean
    inAppEnabled: boolean
    mandatory: boolean
  }[]
}

export interface WhatsAppTemplateView {
  key: string
  title: string
  body: string
  variables: { name: string; label: string }[]
  isCustomized: boolean
}

function templateView(template: ResolvedTemplate): NotificationTemplateView {
  return {
    key: template.key,
    type: template.type,
    channel: 'EMAIL',
    title: template.title,
    subject: template.subject,
    bodyText: template.bodyText,
    variables: template.variables,
    isCustomized: template.isCustomized,
    updatedAt: template.updatedAt,
  }
}

// ------------------------------------------------------- Tipos y canales

async function settingsView(
  config: NotificationConfigRepository,
): Promise<NotificationTypeSettingView[]> {
  const rows = new Map((await config.listSettings()).map((r) => [r.type, r]))
  return NOTIFICATION_CATALOG.map((entry) => {
    const row = rows.get(entry.type)
    return {
      type: entry.type,
      title: entry.title,
      description: entry.description,
      audience: entry.audience,
      enabled: entry.mandatory
        ? true
        : (row?.enabled ?? entry.enabledByDefault),
      channels: row?.channels ?? entry.defaultChannels,
      availableChannels: entry.availableChannels,
      mandatory: entry.mandatory,
    }
  })
}

@QueryHandler(ListNotificationSettingsQuery)
export class ListNotificationSettingsHandler implements IQueryHandler<
  ListNotificationSettingsQuery,
  NotificationTypeSettingView[]
> {
  constructor(private readonly config: NotificationConfigRepository) {}

  execute(): Promise<NotificationTypeSettingView[]> {
    return settingsView(this.config)
  }
}

@CommandHandler(UpdateNotificationSettingsCommand)
export class UpdateNotificationSettingsHandler implements ICommandHandler<
  UpdateNotificationSettingsCommand,
  NotificationTypeSettingView[]
> {
  constructor(private readonly config: NotificationConfigRepository) {}

  async execute(
    command: UpdateNotificationSettingsCommand,
  ): Promise<NotificationTypeSettingView[]> {
    // Se valida todo antes de guardar algo: o entra el pedido entero o ninguno.
    for (const setting of command.settings) {
      const entry = findCatalogEntry(setting.type)
      if (!entry) throw new NotificationTypeUnknownException(setting.type)
      for (const channel of setting.channels) {
        if (!entry.availableChannels.includes(channel)) {
          throw new NotificationChannelNotAvailableException(
            setting.type,
            channel,
          )
        }
      }
      if (entry.mandatory) {
        const keepsDefaults = entry.defaultChannels.every((channel) =>
          setting.channels.includes(channel),
        )
        if (!setting.enabled || !keepsDefaults) {
          throw new NotificationMandatoryException(setting.type)
        }
      } else if (setting.enabled && setting.channels.length === 0) {
        throw new NotificationChannelNotAvailableException(setting.type, '')
      }
    }
    for (const setting of command.settings) {
      await this.config.upsertSetting({
        type: setting.type,
        enabled: setting.enabled,
        channels: [...new Set(setting.channels)],
      })
    }
    return settingsView(this.config)
  }
}

// ------------------------------------------------------------- Plantillas

@QueryHandler(ListNotificationTemplatesQuery)
export class ListNotificationTemplatesHandler implements IQueryHandler<
  ListNotificationTemplatesQuery,
  NotificationTemplateView[]
> {
  constructor(private readonly templates: TemplateService) {}

  async execute(): Promise<NotificationTemplateView[]> {
    return (await this.templates.list()).map(templateView)
  }
}

@CommandHandler(UpdateNotificationTemplateCommand)
export class UpdateNotificationTemplateHandler implements ICommandHandler<
  UpdateNotificationTemplateCommand,
  NotificationTemplateView
> {
  constructor(
    private readonly templates: TemplateService,
    private readonly config: NotificationConfigRepository,
  ) {}

  async execute(
    command: UpdateNotificationTemplateCommand,
  ): Promise<NotificationTemplateView> {
    this.templates.assertValid(command.key, command.subject, command.bodyText)
    await this.config.upsertTemplate(
      command.key,
      command.subject.trim(),
      command.bodyText,
      command.userId,
    )
    return templateView(await this.templates.get(command.key))
  }
}

@CommandHandler(ResetNotificationTemplateCommand)
export class ResetNotificationTemplateHandler implements ICommandHandler<
  ResetNotificationTemplateCommand,
  NotificationTemplateView
> {
  constructor(
    private readonly templates: TemplateService,
    private readonly config: NotificationConfigRepository,
  ) {}

  async execute(
    command: ResetNotificationTemplateCommand,
  ): Promise<NotificationTemplateView> {
    // `get` falla con 404 si la clave no es de una plantilla.
    await this.templates.get(command.key)
    await this.config.deleteTemplate(command.key)
    return templateView(await this.templates.get(command.key))
  }
}

@QueryHandler(PreviewTemplateQuery)
export class PreviewTemplateHandler implements IQueryHandler<
  PreviewTemplateQuery,
  { subject: string; text: string; html: string }
> {
  constructor(private readonly templates: TemplateService) {}

  async execute(
    query: PreviewTemplateQuery,
  ): Promise<{ subject: string; text: string; html: string }> {
    const template = await this.templates.get(query.key)
    this.templates.assertValid(query.key, query.subject, query.bodyText)
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Operación de notificaciones sin tenant')
    return this.templates.preview(
      tenantId,
      template.type as NotificationTypeName,
      query.subject,
      query.bodyText,
    )
  }
}

/**
 * Manda la plantilla de la inmobiliaria con datos de ejemplo al email del
 * usuario logueado, por el mismo camino de entrega que un aviso real (fila en
 * el historial, cola, reintentos), así en local aparece en el adapter de
 * consola.
 */
@CommandHandler(SendTemplateTestCommand)
export class SendTemplateTestHandler implements ICommandHandler<
  SendTemplateTestCommand,
  { sentTo: string }
> {
  constructor(
    private readonly templates: TemplateService,
    private readonly log: NotificationLogRepository,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  async execute(command: SendTemplateTestCommand): Promise<{ sentTo: string }> {
    const template = await this.templates.get(command.key)
    const email = RequestContext.get()?.userEmail
    const tenantId = RequestContext.tenantId
    if (!email) throw new UserWithoutEmailException()
    if (!tenantId) throw new Error('Operación de notificaciones sin tenant')

    const agency = await this.templates.agency(tenantId)
    const rendered = renderEmail(template.subject, template.bodyText, {
      ...this.templates.exampleValues(template.type as NotificationTypeName),
      agencyName: agency.name,
    })
    const row = await this.log.create({
      type: template.type,
      templateKey: template.key,
      channel: 'EMAIL',
      status: 'QUEUED',
      recipientKind: 'TENANT_STAFF',
      recipientId: RequestContext.userId ?? null,
      recipientEmail: email,
      dedupeKey: `TEMPLATE_TEST:${template.key}:${Date.now()}:${RequestContext.userId ?? ''}`,
      subject: `[Prueba] ${rendered.subject}`.slice(0, 200),
      payload: { channels: ['EMAIL'], bodyText: rendered.text, test: true },
    })
    // Es una prueba para quien la pide: sale en el momento y no por la cola.
    if (row) await this.delivery.deliver(row.id)
    return { sentTo: email }
  }
}

// ------------------------------------------------- Preferencias personales

async function preferencesView(
  config: NotificationConfigRepository,
  userId: string,
): Promise<MyPreferencesView> {
  const rows = new Map(
    (await config.listUserPreferences(userId)).map((r) => [r.type, r]),
  )
  return {
    items: NOTIFICATION_CATALOG.map((entry) => {
      const row = rows.get(entry.type)
      const hasEmail = entry.availableChannels.includes('EMAIL')
      const hasInApp = entry.availableChannels.includes('IN_APP')
      return {
        type: entry.type,
        title: entry.title,
        emailEnabled: entry.mandatory
          ? hasEmail
          : (row?.emailEnabled ?? hasEmail),
        inAppEnabled: entry.mandatory
          ? hasInApp
          : (row?.inAppEnabled ?? hasInApp),
        mandatory: entry.mandatory,
      }
    }),
  }
}

@QueryHandler(GetMyPreferencesQuery)
export class GetMyPreferencesHandler implements IQueryHandler<
  GetMyPreferencesQuery,
  MyPreferencesView
> {
  constructor(private readonly config: NotificationConfigRepository) {}

  execute(query: GetMyPreferencesQuery): Promise<MyPreferencesView> {
    return preferencesView(this.config, query.userId)
  }
}

@CommandHandler(UpdateMyPreferencesCommand)
export class UpdateMyPreferencesHandler implements ICommandHandler<
  UpdateMyPreferencesCommand,
  MyPreferencesView
> {
  constructor(private readonly config: NotificationConfigRepository) {}

  async execute(
    command: UpdateMyPreferencesCommand,
  ): Promise<MyPreferencesView> {
    for (const item of command.items) {
      const entry = findCatalogEntry(item.type)
      if (!entry) throw new NotificationTypeUnknownException(item.type)
      const disablesAvailable =
        (!item.emailEnabled && entry.availableChannels.includes('EMAIL')) ||
        (!item.inAppEnabled && entry.availableChannels.includes('IN_APP'))
      // Un obligatorio no se puede apagar; mandarlo "prendido" no cambia nada.
      if (entry.mandatory && disablesAvailable) {
        throw new NotificationMandatoryException(item.type)
      }
    }
    for (const item of command.items) {
      if (findCatalogEntry(item.type)?.mandatory) continue
      await this.config.upsertUserPreference(command.userId, {
        type: item.type,
        emailEnabled: item.emailEnabled,
        inAppEnabled: item.inAppEnabled,
      })
    }
    return preferencesView(this.config, command.userId)
  }
}

// ---------------------------------------------------------------- WhatsApp

@QueryHandler(ListWhatsAppTemplatesQuery)
export class ListWhatsAppTemplatesHandler implements IQueryHandler<
  ListWhatsAppTemplatesQuery,
  WhatsAppTemplateView[]
> {
  constructor(private readonly config: NotificationConfigRepository) {}

  async execute(): Promise<WhatsAppTemplateView[]> {
    const overrides = new Map(
      (await this.config.listWhatsApp()).map((row) => [row.key, row]),
    )
    return DEFAULT_WHATSAPP_TEMPLATES.map((template) => ({
      key: template.key,
      title: template.title,
      body: overrides.get(template.key)?.body ?? template.body,
      variables: template.variables,
      isCustomized: overrides.has(template.key),
    }))
  }
}

@CommandHandler(UpdateWhatsAppTemplateCommand)
export class UpdateWhatsAppTemplateHandler implements ICommandHandler<
  UpdateWhatsAppTemplateCommand,
  WhatsAppTemplateView
> {
  constructor(private readonly config: NotificationConfigRepository) {}

  async execute(
    command: UpdateWhatsAppTemplateCommand,
  ): Promise<WhatsAppTemplateView> {
    const template = findDefaultWhatsAppTemplate(command.key)
    if (!template) throw new TemplateNotFoundException(command.key)
    const allowed = template.variables.map((v) => v.name)
    const unknown = [...command.body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
      .map((m) => m[1])
      .filter((name) => !allowed.includes(name))
    if (unknown.length > 0) {
      throw new TemplateUnknownVariableException([...new Set(unknown)])
    }
    await this.config.upsertWhatsApp(template.key, template.title, command.body)
    return {
      key: template.key,
      title: template.title,
      body: command.body,
      variables: template.variables,
      isCustomized: true,
    }
  }
}
