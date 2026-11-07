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
  AddStatementSettlementsCommand,
  CloseStatementCommand,
  CreateStatementCommand,
  RemoveStatementSettlementCommand,
  ReopenStatementCommand,
} from '@/modules/settlements/application/commands/statement.commands'
import {
  GetStatementQuery,
  ListStatementCandidatesQuery,
  ListStatementsQuery,
} from '@/modules/settlements/application/queries/statement.queries'
import { SettlementSummaryView } from '@/modules/settlements/application/settlement.views'
import {
  OwnerStatementDetailView,
  OwnerStatementSummaryView,
} from '@/modules/settlements/application/statement.views'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import { SettlementSummaryDto } from '../dtos/settlement.dtos'
import {
  AddStatementSettlementsDto,
  CloseOwnerStatementDto,
  CreateOwnerStatementDto,
  ListStatementsQueryDto,
  OwnerStatementDetailDto,
  OwnerStatementSummaryDto,
} from '../dtos/statement.dtos'

/**
 * Consolidado mensual por propietario (4.7, Micaela #7). Admin y empleado;
 * reabrir es sólo admin.
 */
@ApiTags('Settlements')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller('statements')
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class StatementsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Abrir el consolidado del mes de un propietario',
    description:
      'Nace abierto y vacío, con el modo de envío del propietario. Uno por propietario y mes.',
  })
  @ApiResponse({ status: 201, type: OwnerStatementDetailDto })
  @ApiResponse({
    status: 409,
    description: 'Ya hay uno para ese mes',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'El propietario no existe',
    type: ApiErrorDto,
  })
  async create(
    @Body() dto: CreateOwnerStatementDto,
  ): Promise<ApiSuccessDto<OwnerStatementDetailView>> {
    const result = await this.commandBus.execute<
      CreateStatementCommand,
      OwnerStatementDetailView
    >(new CreateStatementCommand(dto.ownerId, dto.period))
    return { success: true, message: 'Consolidado creado', data: result }
  }

  @Get()
  @ApiOperation({ summary: 'Listar consolidados' })
  @ApiPaginatedResponse(
    OwnerStatementSummaryDto,
    'Consolidados de la inmobiliaria',
  )
  async list(
    @Query() query: ListStatementsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<OwnerStatementSummaryView>>> {
    const result = await this.queryBus.execute<
      ListStatementsQuery,
      PaginatedResult<OwnerStatementSummaryView>
    >(
      new ListStatementsQuery(
        { ownerId: query.ownerId, period: query.period, status: query.status },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ficha del consolidado',
    description:
      'Sus liquidaciones con alquiler, punitorios, cargos, honorarios, gastos, ajustes, neto y transferido, y los totales por moneda.',
  })
  @ApiResponse({ status: 200, type: OwnerStatementDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<OwnerStatementDetailView>> {
    const result = await this.queryBus.execute<
      GetStatementQuery,
      OwnerStatementDetailView
    >(new GetStatementQuery(id))
    return { success: true, message: null, data: result }
  }

  @Get(':id/candidates')
  @ApiOperation({
    summary: 'Liquidaciones del propietario que se pueden agregar',
    description: 'Confirmadas o transferidas, sin consolidado.',
  })
  @ApiResponse({ status: 200, type: [SettlementSummaryDto] })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async candidates(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<SettlementSummaryView[]>> {
    const result = await this.queryBus.execute<
      ListStatementCandidatesQuery,
      SettlementSummaryView[]
    >(new ListStatementCandidatesQuery(id))
    return { success: true, message: null, data: result }
  }

  @Post(':id/settlements')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Agregar liquidaciones al consolidado',
    description:
      'Sólo confirmadas o transferidas, del mismo propietario y sin consolidado.',
  })
  @ApiResponse({ status: 200, type: OwnerStatementDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'Cerrado, no confirmada o ya consolidada',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'De otro propietario',
    type: ApiErrorDto,
  })
  async addSettlements(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddStatementSettlementsDto,
  ): Promise<ApiSuccessDto<OwnerStatementDetailView>> {
    const result = await this.commandBus.execute<
      AddStatementSettlementsCommand,
      OwnerStatementDetailView
    >(new AddStatementSettlementsCommand(id, dto.settlementIds))
    return { success: true, message: 'Liquidaciones agregadas', data: result }
  }

  @Delete(':id/settlements/:settlementId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Quitar una liquidación del consolidado (sólo abierto)',
  })
  @ApiResponse({ status: 200, type: OwnerStatementDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Cerrado', type: ApiErrorDto })
  async removeSettlement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('settlementId', new ParseUUIDPipe()) settlementId: string,
  ): Promise<ApiSuccessDto<OwnerStatementDetailView>> {
    const result = await this.commandBus.execute<
      RemoveStatementSettlementCommand,
      OwnerStatementDetailView
    >(new RemoveStatementSettlementCommand(id, settlementId))
    return { success: true, message: 'Liquidación quitada', data: result }
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cerrar el consolidado',
    description:
      'Congela los totales por moneda y el modo de envío; emite el evento para el email y el PDF.',
  })
  @ApiResponse({ status: 200, type: OwnerStatementDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Ya cerrado', type: ApiErrorDto })
  async close(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CloseOwnerStatementDto,
  ): Promise<ApiSuccessDto<OwnerStatementDetailView>> {
    const result = await this.commandBus.execute<
      CloseStatementCommand,
      OwnerStatementDetailView
    >(new CloseStatementCommand(id, dto.sendMode ?? null))
    return { success: true, message: 'Consolidado cerrado', data: result }
  }

  @Post(':id/reopen')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reabrir un consolidado cerrado (sólo admin)' })
  @ApiResponse({ status: 200, type: OwnerStatementDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Ya abierto', type: ApiErrorDto })
  async reopen(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<OwnerStatementDetailView>> {
    const result = await this.commandBus.execute<
      ReopenStatementCommand,
      OwnerStatementDetailView
    >(new ReopenStatementCommand(id))
    return { success: true, message: 'Consolidado reabierto', data: result }
  }
}
