import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { Role, Roles } from '@/modules/auth/public'
import {
  CancelSettlementCommand,
  ConfirmSettlementCommand,
  CreateSettlementAdjustmentCommand,
  CreateSettlementCommand,
  RecalculateSettlementCommand,
  RegisterSettlementTransferCommand,
  VoidSettlementAdjustmentCommand,
  VoidSettlementTransferCommand,
} from '@/modules/settlements/application/commands/settlement.commands'
import {
  GetSettlementQuery,
  ListSettlementsQuery,
} from '@/modules/settlements/application/queries/settlement.queries'
import {
  SettlementDetailView,
  SettlementSummaryView,
} from '@/modules/settlements/application/settlement.views'
import { MAX_RECEIPT_BYTES } from '@/modules/settlements/domain/settlement.policy'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  CreateSettlementAdjustmentDto,
  CreateSettlementDto,
  ListSettlementsQueryDto,
  OwnerSettlementsQueryDto,
  RegisterSettlementTransferDto,
  SettlementDetailDto,
  SettlementSummaryDto,
  VoidDto,
} from '../dtos/settlement.dtos'
import { uploadLimits } from '@/shared/infra/uploads/upload-limits'

/**
 * Liquidaciones (rediseño Fase 12, sección 5). Admin y empleado, salvo
 * cancelar y anular transferencias (sólo admin). Rutas absolutas: el
 * historial por propietario cuelga de `/owners` (propietarios no conoce a
 * liquidaciones).
 */
@ApiTags('Settlements')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller()
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class SettlementsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('settlements')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear la liquidación pendiente de un contrato',
    description:
      'Toma los pagos cobrados por la inmobiliaria sin liquidar, los gastos adelantados pendientes en la moneda del contrato y calcula los honorarios cuota por cuota. Una sola pendiente por contrato.',
  })
  @ApiResponse({ status: 201, type: SettlementDetailDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'Ya hay una pendiente, o no hay nada que liquidar',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'El contrato no existe',
    type: ApiErrorDto,
  })
  async create(
    @Body() dto: CreateSettlementDto,
  ): Promise<ApiSuccessDto<SettlementDetailView>> {
    const result = await this.commandBus.execute<
      CreateSettlementCommand,
      SettlementDetailView
    >(new CreateSettlementCommand(dto.contractId, dto.period ?? null))
    return { success: true, message: 'Liquidación creada', data: result }
  }

  @Get('settlements')
  @ApiOperation({
    summary: 'Listar liquidaciones',
    description: 'Filtros por propietario, propiedad, contrato, mes y estado.',
  })
  @ApiPaginatedResponse(
    SettlementSummaryDto,
    'Liquidaciones de la inmobiliaria',
  )
  async list(
    @Query() query: ListSettlementsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<SettlementSummaryView>>> {
    const result = await this.queryBus.execute<
      ListSettlementsQuery,
      PaginatedResult<SettlementSummaryView>
    >(
      new ListSettlementsQuery(
        {
          ownerId: query.ownerId,
          propertyId: query.propertyId,
          contractId: query.contractId,
          period: query.period,
          status: query.status,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Get('owners/:ownerId/settlements')
  @ApiOperation({
    summary: 'Historial de liquidaciones de un propietario',
    description: 'Ficha del propietario y portal (Fase 17).',
  })
  @ApiPaginatedResponse(SettlementSummaryDto, 'Liquidaciones del propietario')
  async listByOwner(
    @Param('ownerId', new ParseUUIDPipe()) ownerId: string,
    @Query() query: OwnerSettlementsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<SettlementSummaryView>>> {
    const result = await this.queryBus.execute<
      ListSettlementsQuery,
      PaginatedResult<SettlementSummaryView>
    >(
      new ListSettlementsQuery(
        { ownerId, period: query.period, status: query.status },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Get('settlements/:id')
  @ApiOperation({
    summary: 'Ficha de la liquidación',
    description:
      'Pagos incluidos con su cuota, gastos, honorarios con base y modalidad, ajustes, transferencias y consolidado.',
  })
  @ApiResponse({ status: 200, type: SettlementDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<SettlementDetailView>> {
    const result = await this.queryBus.execute<
      GetSettlementQuery,
      SettlementDetailView
    >(new GetSettlementQuery(id))
    return { success: true, message: null, data: result }
  }

  @Post('settlements/:id/recalculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recalcular una liquidación pendiente',
    description:
      'Vuelve a tomar pagos y gastos; los ajustes manuales se conservan.',
  })
  @ApiResponse({ status: 200, type: SettlementDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'No está pendiente',
    type: ApiErrorDto,
  })
  async recalculate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<SettlementDetailView>> {
    const result = await this.commandBus.execute<
      RecalculateSettlementCommand,
      SettlementDetailView
    >(new RecalculateSettlementCommand(id))
    return { success: true, message: 'Liquidación recalculada', data: result }
  }

  @Post('settlements/:id/adjustments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Agregar una retención, un adelanto u otro ajuste',
    description:
      'Sólo sobre una pendiente. El monto es positivo; el concepto da el signo.',
  })
  @ApiResponse({ status: 201, type: SettlementDetailDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'No está pendiente',
    type: ApiErrorDto,
  })
  async addAdjustment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateSettlementAdjustmentDto,
  ): Promise<ApiSuccessDto<SettlementDetailView>> {
    const result = await this.commandBus.execute<
      CreateSettlementAdjustmentCommand,
      SettlementDetailView
    >(new CreateSettlementAdjustmentCommand(id, dto))
    return { success: true, message: 'Ajuste agregado', data: result }
  }

  @Post('settlements/adjustments/:id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Anular un ajuste',
    description: 'Sólo mientras la liquidación está pendiente.',
  })
  @ApiResponse({ status: 200, type: SettlementDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'Ya anulado o liquidación no pendiente',
    type: ApiErrorDto,
  })
  async voidAdjustment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VoidDto,
  ): Promise<ApiSuccessDto<SettlementDetailView>> {
    const result = await this.commandBus.execute<
      VoidSettlementAdjustmentCommand,
      SettlementDetailView
    >(new VoidSettlementAdjustmentCommand(id, dto.reason))
    return { success: true, message: 'Ajuste anulado', data: result }
  }

  @Post('settlements/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirmar la liquidación',
    description:
      'Congela los números, marca los pagos y los gastos como liquidados y, si los honorarios no se descuentan, los devenga en la cuenta del propietario. Inmutable desde ahí.',
  })
  @ApiResponse({ status: 200, type: SettlementDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'No está pendiente',
    type: ApiErrorDto,
  })
  async confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<SettlementDetailView>> {
    const result = await this.commandBus.execute<
      ConfirmSettlementCommand,
      SettlementDetailView
    >(new ConfirmSettlementCommand(id))
    return { success: true, message: 'Liquidación confirmada', data: result }
  }

  @Post('settlements/:id/cancel')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancelar una liquidación pendiente (sólo admin)',
    description:
      'Libera sus pagos y gastos para la próxima liquidación del contrato.',
  })
  @ApiResponse({ status: 200, type: SettlementDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'No está pendiente',
    type: ApiErrorDto,
  })
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VoidDto,
  ): Promise<ApiSuccessDto<SettlementDetailView>> {
    const result = await this.commandBus.execute<
      CancelSettlementCommand,
      SettlementDetailView
    >(new CancelSettlementCommand(id, dto.reason))
    return { success: true, message: 'Liquidación cancelada', data: result }
  }

  @Post('settlements/:id/transfers')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: uploadLimits(MAX_RECEIPT_BYTES) }),
  )
  @ApiOperation({
    summary: 'Registrar una transferencia al propietario',
    description:
      'Multipart. Sólo sobre una confirmada o transferida; la suma no puede superar el neto. Al cubrirlo, la liquidación pasa a TRANSFERRED.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['transferredAt', 'amount', 'method'],
      properties: {
        transferredAt: { type: 'string', format: 'date' },
        amount: { type: 'string', example: '95000.00' },
        method: { type: 'string', enum: ['TRANSFER', 'CASH', 'OTHER'] },
        notes: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, type: SettlementDetailDto })
  @ApiResponse({
    status: 400,
    description: 'Monto, fecha o comprobante inválidos, o supera el neto',
    type: ApiErrorDto,
  })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'No está confirmada',
    type: ApiErrorDto,
  })
  async registerTransfer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RegisterSettlementTransferDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ApiSuccessDto<SettlementDetailView>> {
    const result = await this.commandBus.execute<
      RegisterSettlementTransferCommand,
      SettlementDetailView
    >(
      new RegisterSettlementTransferCommand(
        id,
        {
          transferredAt: dto.transferredAt,
          amount: dto.amount,
          method: dto.method,
          notes: dto.notes ?? null,
        },
        file?.buffer ?? Buffer.alloc(0),
      ),
    )
    return { success: true, message: 'Transferencia registrada', data: result }
  }

  @Post('settlements/transfers/:id/void')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Anular una transferencia (sólo admin)',
    description:
      'Resta del total transferido; la liquidación puede volver a CONFIRMED (A-18).',
  })
  @ApiResponse({ status: 200, type: SettlementDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Ya anulada', type: ApiErrorDto })
  async voidTransfer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VoidDto,
  ): Promise<ApiSuccessDto<SettlementDetailView>> {
    const result = await this.commandBus.execute<
      VoidSettlementTransferCommand,
      SettlementDetailView
    >(new VoidSettlementTransferCommand(id, dto.reason))
    return { success: true, message: 'Transferencia anulada', data: result }
  }
}
