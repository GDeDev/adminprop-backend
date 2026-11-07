import { ChannelName } from '../domain/notification-catalog'
import {
  EmailEventTypeName,
  RecipientKindName,
  StatusName,
} from '../domain/notification.ports'

export interface NotificationFilterInput {
  type?: string
  status?: StatusName
  channel?: ChannelName
  recipientKind?: RecipientKindName
  entityId?: string
  from?: string
  to?: string
}

// ----------------------------------------------------------------- Consultas

export class ListNotificationsQuery {
  constructor(
    public readonly filter: NotificationFilterInput,
    public readonly page: { page?: number; limit?: number },
  ) {}
}

export class GetNotificationQuery {
  constructor(public readonly id: string) {}
}

export class ListNotificationSettingsQuery {}

export class ListNotificationTemplatesQuery {}

export class PreviewTemplateQuery {
  constructor(
    public readonly key: string,
    public readonly subject: string,
    public readonly bodyText: string,
  ) {}
}

export class GetMyPreferencesQuery {
  constructor(public readonly userId: string) {}
}

export class ListWhatsAppTemplatesQuery {}

// ------------------------------------------------------------------ Comandos

export class ResendNotificationCommand {
  constructor(public readonly id: string) {}
}

export class ResendFailedCommand {
  constructor(
    public readonly filter: { type?: string; from?: string; to?: string },
  ) {}
}

export class UpdateNotificationSettingsCommand {
  constructor(
    public readonly settings: {
      type: string
      enabled: boolean
      channels: ChannelName[]
    }[],
  ) {}
}

export class UpdateNotificationTemplateCommand {
  constructor(
    public readonly key: string,
    public readonly subject: string,
    public readonly bodyText: string,
    public readonly userId: string | null,
  ) {}
}

export class ResetNotificationTemplateCommand {
  constructor(public readonly key: string) {}
}

export class SendTemplateTestCommand {
  constructor(public readonly key: string) {}
}

export class UpdateMyPreferencesCommand {
  constructor(
    public readonly userId: string,
    public readonly items: {
      type: string
      emailEnabled: boolean
      inAppEnabled: boolean
    }[],
  ) {}
}

export class UpdateWhatsAppTemplateCommand {
  constructor(
    public readonly key: string,
    public readonly body: string,
  ) {}
}

export class SimulateEmailEventCommand {
  constructor(
    public readonly notificationId: string,
    public readonly type: EmailEventTypeName,
  ) {}
}
