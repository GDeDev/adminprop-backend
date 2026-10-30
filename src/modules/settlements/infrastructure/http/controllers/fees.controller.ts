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
  AllocateFeePaymentCommand,
  RegisterFeePaymentCommand,
  VoidFeePaymentCommand,
} from '@/modules/settlements/application/commands/statement.commands'
import {
  FeePaymentView,
  FeeReceivableView,
  OwnerFeeAccountView,
} from '@/modules/settlements/application/fee.views'
import {
  GetOwnerFeeAccountQuery,
  ListFeeReceivablesQuery,
} from '@/modules/settlements/application/queries/statement.queries'
import { MAX_RECEIPT_BYTES } from '@/modules/settlements/domain/settlement.policy'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import { VoidDto } from '../dtos/settlement.dtos'
import {
  FeePaymentDto,
  FeeReceivableDto,
  ListFeeReceivablesQueryDto,
  OwnerFeeAccountDto,
  RegisterFeePaymentDto,
} from '../dtos/statement.dtos'

/**
 * Cuenta de honorarios de la inmobiliaria (4.8, Micaela #9B y #10). Admin y
 * empleado; anular un pago es sólo admin. Rutas absolutas: la cuenta cuelga
 * de `/owners` (propietarios no conoce a liquidaciones).
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
export class FeesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('fee-receivables')
  @ApiOperation({
    summary: 'Honorarios a cobrar',
    description:
      'Filtros por propietario, contrato y estado. Más nuevos primero.',
  })
  @ApiPaginatedResponse(FeeReceivableDto, 'Honorarios devengados')
  async listReceivables(
    @Query() query: ListFeeReceivablesQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<FeeReceivableView>>> {
    const result = await this.queryBus.execute<
      ListFeeReceivablesQuery,
      PaginatedResult<FeeReceivableView>
    >(
      new ListFeeReceivablesQuery(
        {
          ownerId: query.ownerId,
          contractId: query.contractId,
          status: query.status,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Get('owners/:ownerId/fee-account')
  @ApiOperation({
    summary: 'Cuenta de honorarios de un propietario',
    description:
      'Devengado, cobrado, pendiente y sin imputar por moneda; receivables, pagos y movimientos cronológicos.',
  })
  @ApiResponse({ status: 200, type: OwnerFeeAccountDto })
  @ApiResponse({
    status: 422,
    description: 'El propietario no existe',
    type: ApiErrorDto,
  })
  async account(
    @Param('ownerId', new ParseUUIDPipe()) ownerId: string,
  ): Promise<ApiSuccessDto<OwnerFeeAccountView>> {
    const result = await this.queryBus.execute<
      GetOwnerFeeAccountQuery,
      OwnerFeeAccountView
    >(new GetOwnerFeeAccountQuery(ownerId))
    return { success: true, message: null, data: result }
  }

  @Post('fee-payments')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES } }),
  )
  @ApiOperation({
    summary: 'Registrar un pago de honorarios',
    description:
      'Multipart. Lo paga el propietario o el inquilino por su cuenta. Se imputa a los honorarios pendientes más viejos (del contrato, si viene) en esa moneda; el exceso queda sin imputar.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['ownerId', 'paidAt', 'amount', 'currency', 'method', 'paidBy'],
      properties: {
        ownerId: { type: 'string', format: 'uuid' },
        contractId: { type: 'string', format: 'uuid' },
        paidAt: { type: 'string', format: 'date' },
        amount: { type: 'string', example: '5000.00' },
        currency: { type: 'string', enum: ['ARS', 'USD'] },
        method: { type: 'string', enum: ['TRANSFER', 'CASH', 'OTHER'] },
        paidBy: { type: 'string', enum: ['OWNER', 'RENTER'] },
        notes: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, type: FeePaymentDto })
  @ApiResponse({
    status: 400,
    description: 'Monto, fecha o comprobante inválidos',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Propietario o contrato inválidos',
    type: ApiErrorDto,
  })
  async registerPayment(
    @Body() dto: RegisterFeePaymentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ApiSuccessDto<FeePaymentView>> {
    const result = await this.commandBus.execute<
      RegisterFeePaymentCommand,
      FeePaymentView
    >(
      new RegisterFeePaymentCommand(
        {
          ownerId: dto.ownerId,
          contractId: dto.contractId ?? null,
          paidAt: dto.paidAt,
          amount: dto.amount,
          currency: dto.currency,
          method: dto.method,
          paidBy: dto.paidBy,
          notes: dto.notes ?? null,
        },
        file?.buffer ?? Buffer.alloc(0),
      ),
    )
    return {
      success: true,
      message: 'Pago de honorarios registrado',
      data: result,
    }
  }

  @Post('fee-payments/:id/void')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Anular un pago de honorarios (sólo admin)',
    description:
      'Deshace sus imputaciones: los honorarios vuelven a estar pendientes.',
  })
  @ApiResponse({ status: 200, type: FeePaymentDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Ya anulado', type: ApiErrorDto })
  async voidPayment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VoidDto,
  ): Promise<ApiSuccessDto<FeePaymentView>> {
    const result = await this.commandBus.execute<
      VoidFeePaymentCommand,
      FeePaymentView
    >(new VoidFeePaymentCommand(id, dto.reason))
    return {
      success: true,
      message: 'Pago de honorarios anulado',
      data: result,
    }
  }

  @Post('fee-payments/:id/allocate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Imputar el saldo sin asignar de un pago',
    description:
      'A los honorarios pendientes de hoy del propietario (y del contrato, si el pago vino con uno).',
  })
  @ApiResponse({ status: 200, type: FeePaymentDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Anulado', type: ApiErrorDto })
  async allocate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<FeePaymentView>> {
    const result = await this.commandBus.execute<
      AllocateFeePaymentCommand,
      FeePaymentView
    >(new AllocateFeePaymentCommand(id))
    return { success: true, message: 'Saldo imputado', data: result }
  }
}
