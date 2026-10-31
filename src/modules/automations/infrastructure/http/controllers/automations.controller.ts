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
import {
  GetIndexStatusQuery,
  ListAlertsQuery,
  ListExecutionsQuery,
  ListJobsQuery,
  MarkAlertReadCommand,
  MarkAllAlertsReadCommand,
  RunJobCommand,
} from '@/modules/automations/application/automation.commands'
import { IndexStatusView } from '@/modules/automations/application/automation.handlers'
import {
  InternalAlertView,
  JobExecutionView,
  JobView,
} from '@/modules/automations/application/automation.views'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  IndexStatusDto,
  InternalAlertDto,
  JobDto,
  JobExecutionDto,
  ListAlertsQueryDto,
  ListExecutionsQueryDto,
  ReadAllAlertsResultDto,
  RunJobDto,
  RunJobResultDto,
} from '../dtos/automation.dtos'

/**
 * Automatizaciones (Fase 13, 5): el catálogo de jobs, su historial y la
 * corrida manual, sólo admin. Los avisos internos los leen también los
 * empleados (la campana del dashboard).
 */
@ApiTags('Automations')
@ApiBearerAuth()
@Controller({ path: 'automations' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class AutomationsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('jobs')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Catálogo de jobs',
    description:
      'Nombre, cron legible, última ejecución de la inmobiliaria (o la global, en índices) y próxima corrida prevista.',
  })
  @ApiResponse({ status: 200, type: [JobDto] })
  async jobs(): Promise<ApiSuccessDto<JobView[]>> {
    const jobs = await this.queryBus.execute<ListJobsQuery, JobView[]>(
      new ListJobsQuery(),
    )
    return { success: true, message: null, data: jobs }
  }

  @Get('executions')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Historial de ejecuciones',
    description:
      'Las de la inmobiliaria más las globales (índices). Más nuevas primero.',
  })
  @ApiPaginatedResponse(JobExecutionDto, 'Ejecuciones de jobs')
  async executions(
    @Query() query: ListExecutionsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<JobExecutionView>>> {
    const result = await this.queryBus.execute<
      ListExecutionsQuery,
      PaginatedResult<JobExecutionView>
    >(
      new ListExecutionsQuery(
        {
          job: query.job,
          status: query.status,
          from: query.from,
          to: query.to,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Post('jobs/:job/run')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ejecutar un job ahora',
    description:
      'Encola una corrida manual y responde 202 con el id de la ejecución. Se saltea la condición "hoy es el día N" pero no la idempotencia: no duplica nada. Con `period`, procesa ese mes (generar cuotas, consolidados). `indices.fetch` es global.',
  })
  @ApiResponse({ status: 202, type: RunJobResultDto })
  @ApiResponse({
    status: 404,
    description: 'El job no existe',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Ya hay una corrida en curso de ese job',
    type: ApiErrorDto,
  })
  async run(
    @Param('job') job: string,
    @Body() dto: RunJobDto,
  ): Promise<ApiSuccessDto<{ executionId: string }>> {
    const result = await this.commandBus.execute<
      RunJobCommand,
      { executionId: string }
    >(new RunJobCommand(job, dto.period))
    return { success: true, message: 'Ejecución encolada', data: result }
  }

  @Get('alerts')
  @Roles(Role.ADMIN, Role.EMPLOYEE)
  @ApiOperation({
    summary: 'Avisos internos',
    description:
      'Avisos para el personal de los últimos 30 días (aumento pendiente, índice no disponible, cuota con base desactualizada, consolidado pendiente), más nuevos primero.',
  })
  @ApiPaginatedResponse(InternalAlertDto, 'Avisos internos')
  async alerts(
    @Query() query: ListAlertsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<InternalAlertView>>> {
    const result = await this.queryBus.execute<
      ListAlertsQuery,
      PaginatedResult<InternalAlertView>
    >(
      new ListAlertsQuery(query.unreadOnly ?? false, {
        page: query.page,
        limit: query.limit,
      }),
    )
    return { success: true, message: null, data: result }
  }

  // `read-all` antes que `:id/read`: no chocan por el método, pero queda claro.
  @Post('alerts/read-all')
  @Roles(Role.ADMIN, Role.EMPLOYEE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar todos los avisos como leídos' })
  @ApiResponse({ status: 200, type: ReadAllAlertsResultDto })
  async readAll(): Promise<ApiSuccessDto<{ updated: number }>> {
    const result = await this.commandBus.execute<
      MarkAllAlertsReadCommand,
      { updated: number }
    >(new MarkAllAlertsReadCommand())
    return { success: true, message: null, data: result }
  }

  @Patch('alerts/:id/read')
  @Roles(Role.ADMIN, Role.EMPLOYEE)
  @ApiOperation({ summary: 'Marcar un aviso como leído' })
  @ApiResponse({ status: 200, type: InternalAlertDto })
  @ApiResponse({
    status: 404,
    description: 'El aviso no existe',
    type: ApiErrorDto,
  })
  async read(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<InternalAlertView>> {
    const alert = await this.commandBus.execute<
      MarkAlertReadCommand,
      InternalAlertView
    >(new MarkAlertReadCommand(id))
    return { success: true, message: null, data: alert }
  }
}

/**
 * `GET /indices/status` (Fase 13, 5): vive acá y no en `IndicesController`
 * porque el último intento de traer los índices sale de las ejecuciones de
 * `automations`, que depende de índices y no al revés.
 */
@ApiTags('Indices')
@ApiBearerAuth()
@Controller({ path: 'indices' })
@Roles(Role.ADMIN, Role.EMPLOYEE)
export class IndexStatusController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('status')
  @ApiOperation({
    summary: 'Estado de los índices',
    description:
      'Por tipo: último mes cargado, fuente, último intento de traerlo y su resultado.',
  })
  @ApiResponse({ status: 200, type: [IndexStatusDto] })
  async status(): Promise<ApiSuccessDto<IndexStatusView[]>> {
    const status = await this.queryBus.execute<
      GetIndexStatusQuery,
      IndexStatusView[]
    >(new GetIndexStatusQuery())
    return { success: true, message: null, data: status }
  }
}
