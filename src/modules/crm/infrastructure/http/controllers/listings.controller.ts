import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  PipeTransform,
  Post,
  Query,
  Redirect,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { IsPublic, Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { AppException } from '@/shared/errors'
import {
  ChangeListingStatusCommand,
  CompleteChannelOAuthCommand,
  ConnectChannelCommand,
  DisconnectChannelCommand,
  ListChannelsQuery,
  ListPropertyListingsQuery,
  PublishListingCommand,
} from '../../../application/crm.messages'
import {
  ListingChannelView,
  PropertyListingView,
} from '../../../application/listing.views'
import { ListingChannel } from '../../../domain/listing'
import {
  CallbackQueryDto,
  ConnectChannelResultDto,
  ListingChannelDto,
  PropertyListingDto,
  StartListingResultDto,
} from '../dtos/listing.dtos'

/** Acepta el canal en cualquier mayúscula (`mercadolibre`, `MERCADOLIBRE`). */
class ChannelPipe implements PipeTransform<string, ListingChannel> {
  transform(value: string): ListingChannel {
    const channel = String(value).toUpperCase() as ListingChannel
    if (!Object.values(ListingChannel).includes(channel)) {
      throw AppException.badRequest('El canal no es válido')
    }
    return channel
  }
}

const CHANNEL_PARAM = { name: 'channel', enum: ListingChannel }

/**
 * Canales de publicación (Fase 23, 6.2): estado de las cuentas conectadas.
 * Listar lo ve admin y empleado; conectar y desconectar, sólo el admin.
 */
@ApiTags('CRM')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller('crm/channels')
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class ChannelsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Los tres canales; Zonaprop y Argenprop salen UNAVAILABLE',
  })
  @ApiResponse({ status: 200, type: [ListingChannelDto] })
  async list(): Promise<ApiSuccessDto<ListingChannelView[]>> {
    const data = await this.queryBus.execute<
      ListChannelsQuery,
      ListingChannelView[]
    >(new ListChannelsQuery())
    return { success: true, message: null, data }
  }

  @Post('mercadolibre/connect')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Empezar la conexión con Mercado Libre',
    description:
      'Devuelve la URL del portal a la que hay que mandar al navegador. El `state` va firmado con el tenant y el usuario y vence a los 10 minutos.',
  })
  @ApiResponse({ status: 200, type: ConnectChannelResultDto })
  async connect(): Promise<ApiSuccessDto<{ authorizeUrl: string }>> {
    const data = await this.commandBus.execute<
      ConnectChannelCommand,
      { authorizeUrl: string }
    >(new ConnectChannelCommand(ListingChannel.MERCADOLIBRE))
    return { success: true, message: null, data }
  }

  @Delete(':channel')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Desconectar un canal',
    description:
      'Borra los tokens. Las publicaciones activas quedan en el portal.',
  })
  @ApiParam(CHANNEL_PARAM)
  @ApiResponse({ status: 200, type: [ListingChannelDto] })
  async disconnect(
    @Param('channel', new ChannelPipe()) channel: ListingChannel,
  ): Promise<ApiSuccessDto<ListingChannelView[]>> {
    const data = await this.commandBus.execute<
      DisconnectChannelCommand,
      ListingChannelView[]
    >(new DisconnectChannelCommand(channel))
    return { success: true, message: 'Canal desconectado', data }
  }
}

/**
 * Vuelta del OAuth: la llama el navegador al volver del portal, así que no
 * lleva JWT. Se autentica con el `state` firmado.
 */
@ApiTags('CRM')
@IsPublic()
@Controller('crm/channels')
export class ChannelOAuthController {
  constructor(private readonly commandBus: CommandBus) {}

  @Get('mercadolibre/callback')
  @Redirect()
  @ApiOperation({
    summary: 'Callback del OAuth de Mercado Libre (redirige al backoffice)',
    description:
      'Valida el `state`, canjea el código y guarda los tokens cifrados. Redirige a `/configuracion/canales?connected=mercadolibre` (o `?error=`). Un `state` vencido o manipulado es 400 `OAUTH_STATE_INVALID`.',
  })
  @ApiResponse({ status: 302, description: 'Redirección al backoffice' })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  async callback(
    @Query() query: CallbackQueryDto,
  ): Promise<{ url: string; statusCode: number }> {
    const url = await this.commandBus.execute<
      CompleteChannelOAuthCommand,
      string
    >(
      new CompleteChannelOAuthCommand(
        ListingChannel.MERCADOLIBRE,
        query.code,
        query.state,
        query.error,
      ),
    )
    return { url, statusCode: HttpStatus.FOUND }
  }
}

/** Publicaciones de una propiedad en cada canal (Fase 23, 6.2). */
@ApiTags('CRM')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller('crm/properties/:propertyId/listings')
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
@ApiResponse({
  status: 404,
  description: 'PROPERTY_NOT_FOUND',
  type: ApiErrorDto,
})
export class PropertyListingsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Estado de la propiedad en cada canal' })
  @ApiResponse({ status: 200, type: [PropertyListingDto] })
  async list(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
  ): Promise<ApiSuccessDto<PropertyListingView[]>> {
    const data = await this.queryBus.execute<
      ListPropertyListingsQuery,
      PropertyListingView[]
    >(new ListPropertyListingsQuery(propertyId))
    return { success: true, message: null, data }
  }

  @Post(':channel/publish')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Publicar o actualizar la publicación (trabajo en segundo plano)',
    description:
      'Responde 202 con el `jobId` (consultá `GET /jobs/:id/status`). Valida antes de encolar: 422 `LISTING_NOT_READY` (la lista de lo que falta va en `errors`), 409 `CHANNEL_NOT_CONNECTED`.',
  })
  @ApiParam(CHANNEL_PARAM)
  @ApiResponse({ status: 202, type: StartListingResultDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async publish(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('channel', new ChannelPipe()) channel: ListingChannel,
  ): Promise<ApiSuccessDto<{ jobId: string }>> {
    const data = await this.commandBus.execute<
      PublishListingCommand,
      { jobId: string }
    >(new PublishListingCommand(propertyId, channel, false))
    return { success: true, message: 'Publicación en curso', data }
  }

  @Post(':channel/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Reintentar una publicación en error',
    description: '409 `LISTING_STATE_INVALID` si no está en `ERROR`.',
  })
  @ApiParam(CHANNEL_PARAM)
  @ApiResponse({ status: 202, type: StartListingResultDto })
  async retry(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('channel', new ChannelPipe()) channel: ListingChannel,
  ): Promise<ApiSuccessDto<{ jobId: string }>> {
    const data = await this.commandBus.execute<
      PublishListingCommand,
      { jobId: string }
    >(new PublishListingCommand(propertyId, channel, true))
    return { success: true, message: 'Reintento en curso', data }
  }

  @Post(':channel/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pausar la publicación en el portal' })
  @ApiParam(CHANNEL_PARAM)
  @ApiResponse({ status: 200, type: PropertyListingDto })
  pause(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('channel', new ChannelPipe()) channel: ListingChannel,
  ) {
    return this.change(propertyId, channel, 'pause', 'Publicación pausada')
  }

  @Post(':channel/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reanudar una publicación pausada' })
  @ApiParam(CHANNEL_PARAM)
  @ApiResponse({ status: 200, type: PropertyListingDto })
  resume(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('channel', new ChannelPipe()) channel: ListingChannel,
  ) {
    return this.change(propertyId, channel, 'resume', 'Publicación reanudada')
  }

  @Post(':channel/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cerrar la publicación en el portal',
    description:
      'Un aviso cerrado no se reabre: publicar de nuevo crea uno nuevo.',
  })
  @ApiParam(CHANNEL_PARAM)
  @ApiResponse({ status: 200, type: PropertyListingDto })
  close(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('channel', new ChannelPipe()) channel: ListingChannel,
  ) {
    return this.change(propertyId, channel, 'close', 'Publicación cerrada')
  }

  private async change(
    propertyId: string,
    channel: ListingChannel,
    action: 'pause' | 'resume' | 'close',
    message: string,
  ): Promise<ApiSuccessDto<PropertyListingView>> {
    const data = await this.commandBus.execute<
      ChangeListingStatusCommand,
      PropertyListingView
    >(new ChangeListingStatusCommand(propertyId, channel, action))
    return { success: true, message, data }
  }
}
