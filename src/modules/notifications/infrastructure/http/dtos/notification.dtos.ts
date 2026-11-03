import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator'

import { PaginationQueryDto } from '@/shared/pagination'
import { NOTIFICATION_TYPES } from '../../../domain/notification-catalog'

export enum NotificationChannelEnum {
  EMAIL = 'EMAIL',
  WHATSAPP_LINK = 'WHATSAPP_LINK',
  IN_APP = 'IN_APP',
}

export enum NotificationStatusEnum {
  QUEUED = 'QUEUED',
  SENT = 'SENT',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export enum NotificationRecipientKindEnum {
  TENANT_STAFF = 'TENANT_STAFF',
  RENTER = 'RENTER',
  OWNER = 'OWNER',
  INSURER = 'INSURER',
  EXTERNAL = 'EXTERNAL',
}

export enum EmailEventTypeEnum {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  OPENED = 'OPENED',
  CLICKED = 'CLICKED',
  BOUNCED = 'BOUNCED',
  COMPLAINED = 'COMPLAINED',
  DELAYED = 'DELAYED',
}

const TYPE_VALUES = [...NOTIFICATION_TYPES]

// ------------------------------------------------------------------ Entrada

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TYPE_VALUES })
  @IsOptional()
  @IsIn(TYPE_VALUES)
  type?: string

  @ApiPropertyOptional({ enum: NotificationStatusEnum })
  @IsOptional()
  @IsEnum(NotificationStatusEnum)
  status?: NotificationStatusEnum

  @ApiPropertyOptional({ enum: NotificationChannelEnum })
  @IsOptional()
  @IsEnum(NotificationChannelEnum)
  channel?: NotificationChannelEnum

  @ApiPropertyOptional({ enum: NotificationRecipientKindEnum })
  @IsOptional()
  @IsEnum(NotificationRecipientKindEnum)
  recipientKind?: NotificationRecipientKindEnum

  @ApiPropertyOptional({ description: 'Id de la entidad a la que cuelga' })
  @IsOptional()
  @IsUUID()
  entityId?: string

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDateString()
  from?: string

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDateString()
  to?: string
}

export class ResendFailedDto {
  @ApiPropertyOptional({ enum: TYPE_VALUES })
  @IsOptional()
  @IsIn(TYPE_VALUES)
  type?: string

  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsDateString()
  from?: string

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsDateString()
  to?: string
}

export class NotificationSettingItemDto {
  @ApiProperty({ enum: TYPE_VALUES })
  @IsIn(TYPE_VALUES)
  type: string

  @ApiProperty()
  @IsBoolean()
  enabled: boolean

  @ApiProperty({ enum: NotificationChannelEnum, isArray: true })
  @IsArray()
  @IsEnum(NotificationChannelEnum, { each: true })
  channels: NotificationChannelEnum[]
}

export class UpdateNotificationSettingsDto {
  @ApiProperty({ type: [NotificationSettingItemDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => NotificationSettingItemDto)
  settings: NotificationSettingItemDto[]
}

export class TemplateBodyDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string

  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  bodyText: string
}

export class MyPreferenceItemDto {
  @ApiProperty({ enum: TYPE_VALUES })
  @IsIn(TYPE_VALUES)
  type: string

  @ApiProperty()
  @IsBoolean()
  emailEnabled: boolean

  @ApiProperty()
  @IsBoolean()
  inAppEnabled: boolean
}

export class UpdateMyPreferencesDto {
  @ApiProperty({ type: [MyPreferenceItemDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MyPreferenceItemDto)
  items: MyPreferenceItemDto[]
}

export class UpdateWhatsAppTemplateDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string
}

export class DevEventDto {
  @ApiProperty({ description: 'Id de la notificación (con providerMessageId)' })
  @IsUUID()
  notificationId: string

  @ApiProperty({ enum: EmailEventTypeEnum })
  @IsEnum(EmailEventTypeEnum)
  type: EmailEventTypeEnum
}

// ------------------------------------------------------------------- Salida

export class NotificationLogItemDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: TYPE_VALUES }) type: string
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'PAYMENT_REMINDER.EMAIL',
  })
  templateKey: string | null
  @ApiProperty({ enum: NotificationChannelEnum }) channel: string
  @ApiProperty({ enum: NotificationStatusEnum }) status: string
  @ApiProperty({
    type: String,
    nullable: true,
    enum: [
      'TYPE_DISABLED',
      'CHANNEL_DISABLED',
      'USER_OPTED_OUT',
      'NO_RECIPIENT_EMAIL',
      'NO_PHONE',
    ],
  })
  skipReason: string | null
  @ApiProperty({ enum: NotificationRecipientKindEnum }) recipientKind: string
  @ApiProperty({ description: 'Nombre o email del destinatario' })
  recipientLabel: string
  @ApiProperty({ type: String, nullable: true }) recipientEmail: string | null
  @ApiProperty({ type: String, nullable: true }) entityType: string | null
  @ApiProperty({ type: String, nullable: true }) entityId: string | null
  @ApiProperty() attempts: number
  @ApiProperty({ type: Date, nullable: true }) nextAttemptAt: Date | null
  @ApiProperty({ type: String, nullable: true }) lastError: string | null
  @ApiProperty({ type: Date, nullable: true }) sentAt: Date | null
  @ApiProperty({ type: Date, nullable: true }) deliveredAt: Date | null
  @ApiProperty({ type: Date, nullable: true }) openedAt: Date | null
  @ApiProperty({ type: Date, nullable: true }) bouncedAt: Date | null
  @ApiProperty() createdAt: Date
}

export class EmailEventDto {
  @ApiProperty() id: string
  @ApiProperty({ enum: EmailEventTypeEnum }) type: string
  @ApiProperty() occurredAt: Date
}

export class NotificationDetailDto extends NotificationLogItemDto {
  @ApiProperty({ type: String, nullable: true }) subject: string | null
  @ApiProperty({ type: String, nullable: true }) bodyText: string | null
  @ApiProperty({ type: [EmailEventDto] }) events: EmailEventDto[]
  @ApiProperty() canResend: boolean
}

export class ResendFailedResultDto {
  @ApiProperty({ description: 'AsyncJob: GET /jobs/:id/status' })
  jobId: string
}

export class NotificationTypeSettingDto {
  @ApiProperty({ enum: TYPE_VALUES }) type: string
  @ApiProperty() title: string
  @ApiProperty() description: string
  @ApiProperty({ example: 'Inquilino' }) audience: string
  @ApiProperty() enabled: boolean
  @ApiProperty({ enum: NotificationChannelEnum, isArray: true })
  channels: string[]
  @ApiProperty({ enum: NotificationChannelEnum, isArray: true })
  availableChannels: string[]
  @ApiProperty() mandatory: boolean
}

export class TemplateVariableDto {
  @ApiProperty() name: string
  @ApiProperty() label: string
  @ApiProperty() example: string
}

export class NotificationTemplateDto {
  @ApiProperty({ example: 'PAYMENT_REMINDER.EMAIL' }) key: string
  @ApiProperty({ enum: TYPE_VALUES }) type: string
  @ApiProperty({ enum: ['EMAIL'] }) channel: string
  @ApiProperty() title: string
  @ApiProperty() subject: string
  @ApiProperty() bodyText: string
  @ApiProperty({ type: [TemplateVariableDto] })
  variables: TemplateVariableDto[]
  @ApiProperty() isCustomized: boolean
  @ApiProperty({ type: Date, nullable: true }) updatedAt: Date | null
}

export class TemplatePreviewDto {
  @ApiProperty() subject: string
  @ApiProperty() text: string
  @ApiProperty() html: string
}

export class TestTemplateResultDto {
  @ApiProperty() sentTo: string
}

export class MyPreferenceItemViewDto {
  @ApiProperty({ enum: TYPE_VALUES }) type: string
  @ApiProperty() title: string
  @ApiProperty() emailEnabled: boolean
  @ApiProperty() inAppEnabled: boolean
  @ApiProperty() mandatory: boolean
}

export class MyNotificationPreferencesDto {
  @ApiProperty({ type: [MyPreferenceItemViewDto] })
  items: MyPreferenceItemViewDto[]
}

export class WhatsAppVariableDto {
  @ApiProperty() name: string
  @ApiProperty() label: string
}

export class WhatsAppTemplateDto {
  @ApiProperty({ example: 'PAYMENT_REMINDER' }) key: string
  @ApiProperty() title: string
  @ApiProperty() body: string
  @ApiProperty({ type: [WhatsAppVariableDto] })
  variables: WhatsAppVariableDto[]
  @ApiProperty() isCustomized: boolean
}

export class RecordedEventDto {
  @ApiProperty() recorded: boolean
}
