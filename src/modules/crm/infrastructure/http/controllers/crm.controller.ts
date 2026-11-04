import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  CrmOverviewView,
  PropertyAnalyticsView,
} from '../../../application/analytics.handlers'
import {
  AddInquiryNoteCommand,
  AssignInquiryCommand,
  CreateInquiryCommand,
  GetCrmOverviewQuery,
  GetInquiryQuery,
  GetPipelineQuery,
  GetPropertyAnalyticsQuery,
  GetWhatsAppLinkQuery,
  ListAssigneesQuery,
  ListInquiriesQuery,
  MoveInquiryCommand,
  RecordContactAttemptCommand,
  UpdateInquiryCommand,
} from '../../../application/crm.messages'
import {
  InquiryActivityView,
  InquiryCardView,
  InquiryDetailView,
  PipelineView,
} from '../../../application/crm.views'
import {
  AddInquiryNoteDto,
  AssignInquiryDto,
  ContactAttemptDto,
  CreateInquiryDto,
  CrmAssigneeDto,
  CrmOverviewDto,
  InquiryActivityDto,
  InquiryCardDto,
  InquiryDetailDto,
  ListInquiriesQueryDto,
  MoveInquiryDto,
  PipelineDto,
  PipelineQueryDto,
  PropertyInquiryAnalyticsDto,
  RangeQueryDto,
  UpdateInquiryDto,
  WhatsAppLinkDto,
} from '../dtos/crm.dtos'

/**
 * CRM de consultas (Fase 23, 5): tablero, detalle, notas, asignación,
 * seguimiento, WhatsApp y analítica. Admin y empleado; propietarios e
 * inquilinos reciben 403 (A-89). Todo dentro del tenant del token.
 */
@ApiTags('CRM')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller('crm')
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class CrmController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('pipeline')
  @ApiOperation({
    summary: 'Tablero: 6 columnas con hasta 50 tarjetas cada una',
  })
  @ApiResponse({ status: 200, type: PipelineDto })
  async pipeline(
    @Query() query: PipelineQueryDto,
  ): Promise<ApiSuccessDto<PipelineView>> {
    const data = await this.queryBus.execute<GetPipelineQuery, PipelineView>(
      new GetPipelineQuery(query),
    )
    return { success: true, message: null, data }
  }

  @Get('inquiries')
  @ApiOperation({
    summary: 'Consultas paginadas (ver más de una columna, lista mobile)',
    description:
      'Con `stage` ordena por posición del tablero; sin él, las más nuevas primero.',
  })
  @ApiPaginatedResponse(InquiryCardDto, 'Consultas')
  async list(
    @Query() query: ListInquiriesQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<InquiryCardView>>> {
    const { page, limit, ...filter } = query
    const data = await this.queryBus.execute<
      ListInquiriesQuery,
      PaginatedResult<InquiryCardView>
    >(new ListInquiriesQuery(filter, { page, limit }))
    return { success: true, message: null, data }
  }

  @Post('inquiries')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cargar una consulta a mano (llamado, WhatsApp, visita)',
  })
  @ApiResponse({ status: 201, type: InquiryDetailDto })
  @ApiResponse({
    status: 422,
    description: 'ASSIGNEE_INVALID o INQUIRY_CONTACT_REQUIRED',
    type: ApiErrorDto,
  })
  async create(
    @Body() dto: CreateInquiryDto,
  ): Promise<ApiSuccessDto<InquiryDetailView>> {
    const data = await this.commandBus.execute<
      CreateInquiryCommand,
      InquiryDetailView
    >(new CreateInquiryCommand(dto))
    return { success: true, message: 'Consulta cargada', data }
  }

  @Get('inquiries/:id')
  @ApiOperation({ summary: 'Detalle de una consulta con su línea de tiempo' })
  @ApiResponse({ status: 200, type: InquiryDetailDto })
  @ApiResponse({
    status: 404,
    description: 'INQUIRY_NOT_FOUND',
    type: ApiErrorDto,
  })
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<InquiryDetailView>> {
    const data = await this.queryBus.execute<
      GetInquiryQuery,
      InquiryDetailView
    >(new GetInquiryQuery(id))
    return { success: true, message: null, data }
  }

  @Patch('inquiries/:id')
  @ApiOperation({
    summary: 'Editar datos de contacto, propiedad o seguimiento',
  })
  @ApiResponse({ status: 200, type: InquiryDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateInquiryDto,
  ): Promise<ApiSuccessDto<InquiryDetailView>> {
    const data = await this.commandBus.execute<
      UpdateInquiryCommand,
      InquiryDetailView
    >(new UpdateInquiryCommand(id, dto))
    return { success: true, message: 'Consulta actualizada', data }
  }

  @Patch('inquiries/:id/stage')
  @ApiOperation({
    summary: 'Mover una tarjeta de columna o de lugar',
    description:
      'La posición sale de los vecinos (`beforeId` arriba, `afterId` abajo); sin vecinos va arriba. `CLOSED_LOST` exige `lostReason` (422 `LOST_REASON_REQUIRED`). Reabrir una cerrada está permitido.',
  })
  @ApiResponse({ status: 200, type: InquiryCardDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async move(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MoveInquiryDto,
  ): Promise<ApiSuccessDto<InquiryCardView>> {
    const data = await this.commandBus.execute<
      MoveInquiryCommand,
      InquiryCardView
    >(new MoveInquiryCommand(id, dto))
    return { success: true, message: 'Consulta movida', data }
  }

  @Patch('inquiries/:id/assign')
  @ApiOperation({
    summary: 'Asignar la consulta a un usuario (null la libera)',
  })
  @ApiResponse({ status: 200, type: InquiryCardDto })
  @ApiResponse({
    status: 422,
    description: 'ASSIGNEE_INVALID',
    type: ApiErrorDto,
  })
  async assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignInquiryDto,
  ): Promise<ApiSuccessDto<InquiryCardView>> {
    const data = await this.commandBus.execute<
      AssignInquiryCommand,
      InquiryCardView
    >(new AssignInquiryCommand(id, dto.userId))
    return { success: true, message: 'Consulta asignada', data }
  }

  @Post('inquiries/:id/notes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Agregar una nota',
    description: 'Las notas no se editan ni se borran: queda el rastro.',
  })
  @ApiResponse({ status: 201, type: InquiryActivityDto })
  async addNote(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddInquiryNoteDto,
  ): Promise<ApiSuccessDto<InquiryActivityView>> {
    const data = await this.commandBus.execute<
      AddInquiryNoteCommand,
      InquiryActivityView
    >(new AddInquiryNoteCommand(id, dto.body))
    return { success: true, message: 'Nota agregada', data }
  }

  @Post('inquiries/:id/contact-attempts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar un intento de contacto',
    description:
      'Fija el último contacto y, si la consulta estaba en `NEW`, la pasa a `CONTACTED`.',
  })
  @ApiResponse({ status: 201, type: InquiryCardDto })
  async contactAttempt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ContactAttemptDto,
  ): Promise<ApiSuccessDto<InquiryCardView>> {
    const data = await this.commandBus.execute<
      RecordContactAttemptCommand,
      InquiryCardView
    >(new RecordContactAttemptCommand(id, dto.channel))
    return { success: true, message: 'Contacto registrado', data }
  }

  @Get('inquiries/:id/whatsapp-link')
  @ApiOperation({
    summary: 'Link de WhatsApp con el mensaje de la plantilla ya armado',
    description:
      '`url` es null si la consulta no tiene un teléfono utilizable. Plantilla por defecto: `INQUIRY_FIRST_CONTACT`.',
  })
  @ApiResponse({ status: 200, type: WhatsAppLinkDto })
  async whatsapp(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('templateKey') templateKey?: string,
  ): Promise<ApiSuccessDto<{ url: string | null; message: string }>> {
    const data = await this.queryBus.execute<
      GetWhatsAppLinkQuery,
      { url: string | null; message: string }
    >(new GetWhatsAppLinkQuery(id, templateKey))
    return { success: true, message: null, data }
  }

  @Get('assignees')
  @ApiOperation({ summary: 'Personal activo al que se puede asignar' })
  @ApiResponse({ status: 200, type: [CrmAssigneeDto] })
  async assignees(): Promise<
    ApiSuccessDto<{ id: string; fullName: string; role: string }[]>
  > {
    const data = await this.queryBus.execute<
      ListAssigneesQuery,
      { id: string; fullName: string; role: string }[]
    >(new ListAssigneesQuery())
    return { success: true, message: null, data }
  }

  @Get('analytics/overview')
  @ApiOperation({ summary: 'Resumen del CRM en un rango de fechas' })
  @ApiResponse({ status: 200, type: CrmOverviewDto })
  @ApiResponse({
    status: 422,
    description: 'ANALYTICS_RANGE_INVALID',
    type: ApiErrorDto,
  })
  async overview(
    @Query() query: RangeQueryDto,
  ): Promise<ApiSuccessDto<CrmOverviewView>> {
    const data = await this.queryBus.execute<
      GetCrmOverviewQuery,
      CrmOverviewView
    >(new GetCrmOverviewQuery(query.from, query.to))
    return { success: true, message: null, data }
  }

  @Get('analytics/properties/:propertyId')
  @ApiOperation({
    summary: 'Vistas, consultas y conversión de una propiedad',
    description:
      'Las vistas se cuentan desde la activación de la fase; antes figuran en 0.',
  })
  @ApiResponse({ status: 200, type: PropertyInquiryAnalyticsDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async propertyAnalytics(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query() query: RangeQueryDto,
  ): Promise<ApiSuccessDto<PropertyAnalyticsView>> {
    const data = await this.queryBus.execute<
      GetPropertyAnalyticsQuery,
      PropertyAnalyticsView
    >(new GetPropertyAnalyticsQuery(propertyId, query.from, query.to))
    return { success: true, message: null, data }
  }
}
