import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import {
  AuthenticatedUser,
  CurrentUser,
  Role,
  Roles,
} from '@/modules/auth/public'
import { Configuration } from '@/shared/config/configuration'
import { EmailProvider } from '@/shared/config/env.validation'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  GetMyPreferencesQuery,
  GetNotificationQuery,
  ListNotificationSettingsQuery,
  ListNotificationsQuery,
  ListNotificationTemplatesQuery,
  ListWhatsAppTemplatesQuery,
  PreviewTemplateQuery,
  ResendFailedCommand,
  ResendNotificationCommand,
  ResetNotificationTemplateCommand,
  SendTemplateTestCommand,
  SimulateEmailEventCommand,
  UpdateMyPreferencesCommand,
  UpdateNotificationSettingsCommand,
  UpdateNotificationTemplateCommand,
  UpdateWhatsAppTemplateCommand,
} from '../../../application/notification.commands'
import {
  MyPreferencesView,
  NotificationTemplateView,
  NotificationTypeSettingView,
  WhatsAppTemplateView,
} from '../../../application/notification-config.handlers'
import {
  NotificationDetailView,
  NotificationLogItemView,
} from '../../../application/notification.views'
import { DevEventsDisabledException } from '../../../domain/notification.exceptions'
import { ChannelName } from '../../../domain/notification-catalog'
import {
  DevEventDto,
  ListNotificationsQueryDto,
  MyNotificationPreferencesDto,
  NotificationDetailDto,
  NotificationLogItemDto,
  NotificationTemplateDto,
  NotificationTypeSettingDto,
  RecordedEventDto,
  ResendFailedDto,
  ResendFailedResultDto,
  TemplateBodyDto,
  TemplatePreviewDto,
  TestTemplateResultDto,
  UpdateMyPreferencesDto,
  UpdateNotificationSettingsDto,
  UpdateWhatsAppTemplateDto,
  WhatsAppTemplateDto,
} from '../dtos/notification.dtos'

const ok = <T>(data: T, message: string | null = null): ApiSuccessDto<T> => ({
  success: true,
  message,
  data,
})

/**
 * Notificaciones y mailing (Fase 14): historial, configuración por tipo,
 * plantillas de email y WhatsApp, y preferencias personales. Lo de la
 * inmobiliaria es sólo del admin; las preferencias propias y las plantillas de
 * WhatsApp (que se leen desde los botones del backoffice) también las usa el
 * empleado.
 *
 * Las rutas fijas van antes que `:id` para que no se confundan con un id.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class NotificationsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly config: ConfigService<Configuration, true>,
  ) {}

  // ----------------------------------------------------------- Historial

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Historial de notificaciones',
    description:
      'Los envíos de la inmobiliaria, más nuevos primero (los avisos internos de la campana no figuran: están en `/automations/alerts`).',
  })
  @ApiPaginatedResponse(NotificationLogItemDto, 'Historial de notificaciones')
  async list(
    @Query() query: ListNotificationsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<NotificationLogItemView>>> {
    const result = await this.queryBus.execute<
      ListNotificationsQuery,
      PaginatedResult<NotificationLogItemView>
    >(
      new ListNotificationsQuery(
        {
          type: query.type,
          status: query.status,
          channel: query.channel,
          recipientKind: query.recipientKind,
          entityId: query.entityId,
          from: query.from,
          to: query.to,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return ok(result)
  }

  @Post('resend-failed')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Reintentar todas las notificaciones fallidas',
    description:
      'Encola un trabajo (`notifications-resend-failed`) y responde 202 con su id. El avance se consulta en `GET /jobs/:id/status`.',
  })
  @ApiResponse({ status: 202, type: ResendFailedResultDto })
  async resendFailed(
    @Body() dto: ResendFailedDto,
  ): Promise<ApiSuccessDto<{ jobId: string }>> {
    const result = await this.commandBus.execute<
      ResendFailedCommand,
      { jobId: string }
    >(new ResendFailedCommand({ type: dto.type, from: dto.from, to: dto.to }))
    return ok(result, 'Reintento encolado')
  }

  // ------------------------------------------------------- Tipos y canales

  @Get('settings')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Tipos de aviso y sus canales',
    description: 'El catálogo con el estado de la inmobiliaria.',
  })
  @ApiResponse({ status: 200, type: [NotificationTypeSettingDto] })
  async settings(): Promise<ApiSuccessDto<NotificationTypeSettingView[]>> {
    return ok(
      await this.queryBus.execute<
        ListNotificationSettingsQuery,
        NotificationTypeSettingView[]
      >(new ListNotificationSettingsQuery()),
    )
  }

  @Put('settings')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Habilitar tipos de aviso y elegir canales',
    description:
      'Un tipo obligatorio no se puede deshabilitar ni sacarle sus canales originales (422 `NOTIFICATION_MANDATORY`).',
  })
  @ApiResponse({ status: 200, type: [NotificationTypeSettingDto] })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async updateSettings(
    @Body() dto: UpdateNotificationSettingsDto,
  ): Promise<ApiSuccessDto<NotificationTypeSettingView[]>> {
    return ok(
      await this.commandBus.execute<
        UpdateNotificationSettingsCommand,
        NotificationTypeSettingView[]
      >(
        new UpdateNotificationSettingsCommand(
          dto.settings.map((s) => ({
            type: s.type,
            enabled: s.enabled,
            channels: s.channels as ChannelName[],
          })),
        ),
      ),
    )
  }

  // ------------------------------------------------------------ Plantillas

  @Get('templates')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Plantillas de email' })
  @ApiResponse({ status: 200, type: [NotificationTemplateDto] })
  async templates(): Promise<ApiSuccessDto<NotificationTemplateView[]>> {
    return ok(
      await this.queryBus.execute<
        ListNotificationTemplatesQuery,
        NotificationTemplateView[]
      >(new ListNotificationTemplatesQuery()),
    )
  }

  @Put('templates/:key')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Editar una plantilla',
    description:
      'Usar una variable que el tipo no declara da 422 `TEMPLATE_UNKNOWN_VARIABLE`.',
  })
  @ApiResponse({ status: 200, type: NotificationTemplateDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async updateTemplate(
    @Param('key') key: string,
    @Body() dto: TemplateBodyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessDto<NotificationTemplateView>> {
    return ok(
      await this.commandBus.execute<
        UpdateNotificationTemplateCommand,
        NotificationTemplateView
      >(
        new UpdateNotificationTemplateCommand(
          key,
          dto.subject,
          dto.bodyText,
          user.id,
        ),
      ),
    )
  }

  @Delete('templates/:key')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Restaurar el texto original de una plantilla' })
  @ApiResponse({ status: 200, type: NotificationTemplateDto })
  async resetTemplate(
    @Param('key') key: string,
  ): Promise<ApiSuccessDto<NotificationTemplateView>> {
    return ok(
      await this.commandBus.execute<
        ResetNotificationTemplateCommand,
        NotificationTemplateView
      >(new ResetNotificationTemplateCommand(key)),
    )
  }

  @Post('templates/:key/preview')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vista previa de una plantilla',
    description: 'Con datos de ejemplo del tipo. No envía nada.',
  })
  @ApiResponse({ status: 200, type: TemplatePreviewDto })
  async preview(
    @Param('key') key: string,
    @Body() dto: TemplateBodyDto,
  ): Promise<ApiSuccessDto<{ subject: string; text: string; html: string }>> {
    return ok(
      await this.queryBus.execute(
        new PreviewTemplateQuery(key, dto.subject, dto.bodyText),
      ),
    )
  }

  @Post('templates/:key/test')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enviarme una prueba',
    description:
      'Manda la plantilla vigente con datos de ejemplo al email del usuario logueado, por el mismo camino de entrega que un aviso real.',
  })
  @ApiResponse({ status: 200, type: TestTemplateResultDto })
  async test(
    @Param('key') key: string,
  ): Promise<ApiSuccessDto<{ sentTo: string }>> {
    return ok(
      await this.commandBus.execute<
        SendTemplateTestCommand,
        { sentTo: string }
      >(new SendTemplateTestCommand(key)),
    )
  }

  // -------------------------------------------------- Preferencias propias

  @Get('me/preferences')
  @Roles(Role.ADMIN, Role.EMPLOYEE)
  @ApiOperation({ summary: 'Mis preferencias de notificación' })
  @ApiResponse({ status: 200, type: MyNotificationPreferencesDto })
  async myPreferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessDto<MyPreferencesView>> {
    return ok(
      await this.queryBus.execute<GetMyPreferencesQuery, MyPreferencesView>(
        new GetMyPreferencesQuery(user.id),
      ),
    )
  }

  @Put('me/preferences')
  @Roles(Role.ADMIN, Role.EMPLOYEE)
  @ApiOperation({
    summary: 'Actualizar mis preferencias de notificación',
    description:
      'Sólo aplican a los avisos al personal que no son obligatorios. Apagar uno obligatorio da 422 `NOTIFICATION_MANDATORY`.',
  })
  @ApiResponse({ status: 200, type: MyNotificationPreferencesDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async updateMyPreferences(
    @Body() dto: UpdateMyPreferencesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApiSuccessDto<MyPreferencesView>> {
    return ok(
      await this.commandBus.execute<
        UpdateMyPreferencesCommand,
        MyPreferencesView
      >(new UpdateMyPreferencesCommand(user.id, dto.items)),
    )
  }

  // --------------------------------------------------------------- WhatsApp

  @Get('whatsapp-templates')
  @Roles(Role.ADMIN, Role.EMPLOYEE)
  @ApiOperation({
    summary: 'Plantillas de WhatsApp',
    description:
      'Los textos con los que el backoffice arma los links `wa.me` (recordatorio, mora, primer contacto de una consulta).',
  })
  @ApiResponse({ status: 200, type: [WhatsAppTemplateDto] })
  async whatsapp(): Promise<ApiSuccessDto<WhatsAppTemplateView[]>> {
    return ok(
      await this.queryBus.execute<
        ListWhatsAppTemplatesQuery,
        WhatsAppTemplateView[]
      >(new ListWhatsAppTemplatesQuery()),
    )
  }

  @Put('whatsapp-templates/:key')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Editar una plantilla de WhatsApp' })
  @ApiResponse({ status: 200, type: WhatsAppTemplateDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async updateWhatsapp(
    @Param('key') key: string,
    @Body() dto: UpdateWhatsAppTemplateDto,
  ): Promise<ApiSuccessDto<WhatsAppTemplateView>> {
    return ok(
      await this.commandBus.execute<
        UpdateWhatsAppTemplateCommand,
        WhatsAppTemplateView
      >(new UpdateWhatsAppTemplateCommand(key, dto.body)),
    )
  }

  // ---------------------------------------------------------- Sólo desarrollo

  @Post('dev/events')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Simular un evento del proveedor de email (sólo desarrollo)',
    description:
      'Registra un evento (entregado, abierto, rebotó...) sobre una notificación ya enviada. Sólo con `EMAIL_PROVIDER=console` y fuera de producción; si no, 404.',
  })
  @ApiResponse({ status: 200, type: RecordedEventDto })
  async devEvent(
    @Body() dto: DevEventDto,
  ): Promise<ApiSuccessDto<{ recorded: boolean }>> {
    const app = this.config.get('app', { infer: true })
    const email = this.config.get('email', { infer: true })
    if (email.provider !== EmailProvider.Console || app.isProduction) {
      throw new DevEventsDisabledException()
    }
    return ok(
      await this.commandBus.execute<
        SimulateEmailEventCommand,
        { recorded: boolean }
      >(new SimulateEmailEventCommand(dto.notificationId, dto.type)),
    )
  }

  // ------------------------------------------------------------ Por id (al final)

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Detalle de una notificación',
    description:
      'Con el asunto, el texto enviado y la cronología de entregas, aperturas y rebotes.',
  })
  @ApiResponse({ status: 200, type: NotificationDetailDto })
  @ApiResponse({
    status: 404,
    description: 'No existe, o es de otra inmobiliaria',
    type: ApiErrorDto,
  })
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<NotificationDetailView>> {
    return ok(
      await this.queryBus.execute<GetNotificationQuery, NotificationDetailView>(
        new GetNotificationQuery(id),
      ),
    )
  }

  @Post(':id/resend')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reenviar una notificación fallida',
    description:
      'Vuelve a encolarla con los intentos en cero. Queda en la auditoría.',
  })
  @ApiResponse({ status: 200, type: NotificationLogItemDto })
  @ApiResponse({
    status: 409,
    description:
      'La notificación no está fallida (`NOTIFICATION_NOT_RESENDABLE`)',
    type: ApiErrorDto,
  })
  async resend(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<NotificationLogItemView>> {
    return ok(
      await this.commandBus.execute<
        ResendNotificationCommand,
        NotificationLogItemView
      >(new ResendNotificationCommand(id)),
      'Reenvío encolado',
    )
  }
}
