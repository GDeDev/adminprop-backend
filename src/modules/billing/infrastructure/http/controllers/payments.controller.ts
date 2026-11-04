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
  AdjustLateFeeCommand,
  ApplyCreditCommand,
  ConfirmPaymentCommand,
  CreateChargeCommand,
  RefundCreditCommand,
  RegisterPaymentCommand,
  VoidChargeCommand,
  VoidPaymentCommand,
} from '@/modules/billing/application/commands/billing.commands'
import { RegisterPaymentResult } from '@/modules/billing/application/commands/payment.handlers'
import {
  InstallmentDetailView,
  PaymentListItemView,
  PaymentView,
  RenterArrearsView,
  RenterCreditsView,
  RenterCreditView,
} from '@/modules/billing/application/installment.views'
import {
  GetArrearsQuery,
  ListPaymentsQuery,
  ListRenterCreditsQuery,
} from '@/modules/billing/application/queries/billing.queries'
import { MAX_RECEIPT_BYTES } from '@/modules/billing/domain/payment.policy'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  ApplyCreditDto,
  ArrearsQueryDto,
  CreateChargeDto,
  CreateLateFeeAdjustmentDto,
  InstallmentDetailDto,
  ListPaymentsQueryDto,
  PaymentDto,
  PaymentListItemDto,
  RefundCreditDto,
  RegisterPaymentDto,
  RegisterPaymentResultDto,
  RenterArrearsDto,
  RenterCreditDto,
  RenterCreditsDto,
  VoidDto,
} from '../dtos/billing.dtos'
import { uploadLimits } from '@/shared/infra/uploads/upload-limits'

/**
 * Pagos, cargos, ajustes del punitorio y saldos a favor (rediseño 5). Admin
 * y empleado, salvo anular pagos, ajustar punitorios y devolver saldos
 * (sólo admin).
 */
@ApiTags('Billing')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller('billing')
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class PaymentsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('installments/:id/charges')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Agregar un cargo a la cuota',
    description:
      'Expensas, multa de rescisión u otro concepto, en la moneda de la cuota. Sólo sobre una cuota no saldada. No devenga punitorio.',
  })
  @ApiResponse({ status: 201, type: InstallmentDetailDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Cuota saldada', type: ApiErrorDto })
  async createCharge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateChargeDto,
  ): Promise<ApiSuccessDto<InstallmentDetailView>> {
    const result = await this.commandBus.execute<
      CreateChargeCommand,
      InstallmentDetailView
    >(new CreateChargeCommand(id, dto))
    return { success: true, message: 'Cargo agregado', data: result }
  }

  @Post('charges/:id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Anular un cargo sin imputaciones',
    description: 'El cargo queda registrado como anulado y deja de contar.',
  })
  @ApiResponse({ status: 200, type: InstallmentDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'Ya anulado, o con pagos imputados',
    type: ApiErrorDto,
  })
  async voidCharge(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VoidDto,
  ): Promise<ApiSuccessDto<InstallmentDetailView>> {
    const result = await this.commandBus.execute<
      VoidChargeCommand,
      InstallmentDetailView
    >(new VoidChargeCommand(id, dto.reason))
    return { success: true, message: 'Cargo anulado', data: result }
  }

  @Post('installments/:id/payments')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: uploadLimits(MAX_RECEIPT_BYTES) }),
  )
  @ApiOperation({
    summary: 'Registrar un pago',
    description:
      'Multipart. Parcial o total, en la moneda del contrato o en la otra con cotización (fuente, fecha, valor). Se aplican antes los saldos a favor (`applyCredit`, default true); después el pago se imputa punitorio → alquiler → cargos, o según `allocation` (JSON). El exceso queda como saldo a favor. Recibido por el propietario nace pendiente de confirmación.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['paidAt', 'amount', 'paidCurrency', 'method'],
      properties: {
        paidAt: { type: 'string', format: 'date' },
        amount: { type: 'string', example: '150000.00' },
        paidCurrency: { type: 'string', enum: ['ARS', 'USD'] },
        exchangeRate: { type: 'string', example: '1487.5000' },
        exchangeRateSource: {
          type: 'string',
          enum: ['OFFICIAL', 'MEP', 'OTHER'],
        },
        exchangeRateDate: { type: 'string', format: 'date' },
        method: { type: 'string', enum: ['TRANSFER', 'CASH', 'OTHER'] },
        receivedBy: { type: 'string', enum: ['AGENCY', 'OWNER'] },
        allocation: {
          type: 'string',
          example: '{"lateFee":"0.00","rent":"100000.00","charges":"0.00"}',
        },
        applyCredit: { type: 'string', enum: ['true', 'false'] },
        notes: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, type: RegisterPaymentResultDto })
  @ApiResponse({
    status: 400,
    description: 'Monto, fecha, cotización, imputación o comprobante inválidos',
    type: ApiErrorDto,
  })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, description: 'Cuota saldada', type: ApiErrorDto })
  async registerPayment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RegisterPaymentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ApiSuccessDto<RegisterPaymentResult>> {
    const result = await this.commandBus.execute<
      RegisterPaymentCommand,
      RegisterPaymentResult
    >(
      new RegisterPaymentCommand(
        id,
        {
          paidAt: dto.paidAt,
          amount: dto.amount,
          paidCurrency: dto.paidCurrency,
          exchangeRate: dto.exchangeRate ?? null,
          exchangeRateSource: dto.exchangeRateSource ?? null,
          exchangeRateDate: dto.exchangeRateDate ?? null,
          method: dto.method,
          receivedBy: dto.receivedBy ?? null,
          allocation: dto.allocation ?? null,
          applyCredit: dto.applyCredit ?? true,
          notes: dto.notes ?? null,
        },
        file?.buffer ?? Buffer.alloc(0),
      ),
    )
    return { success: true, message: 'Pago registrado', data: result }
  }

  @Post('installments/:id/apply-credit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Aplicar saldo a favor a la cuota, a mano',
    description:
      'Sin plata: aplica los créditos disponibles del inquilino en la moneda del contrato (o uno puntual, hasta un monto). `payment` es la primera aplicación; `creditApplications`, las demás.',
  })
  @ApiResponse({ status: 201, type: RegisterPaymentResultDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'Sin saldo a favor disponible, otra moneda, o cuota saldada',
    type: ApiErrorDto,
  })
  async applyCredit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApplyCreditDto,
  ): Promise<ApiSuccessDto<RegisterPaymentResult>> {
    const result = await this.commandBus.execute<
      ApplyCreditCommand,
      RegisterPaymentResult
    >(new ApplyCreditCommand(id, dto.creditId, dto.amount))
    return { success: true, message: 'Saldo a favor aplicado', data: result }
  }

  @Post('installments/:id/late-fee-adjustments')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Reducir o condonar el punitorio (sólo admin)',
    description:
      'REDUCE descuenta `amount` del punitorio pendiente; WAIVE lo condona entero y deja de devengar. Siempre con motivo.',
  })
  @ApiResponse({ status: 201, type: InstallmentDetailDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async adjustLateFee(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateLateFeeAdjustmentDto,
  ): Promise<ApiSuccessDto<InstallmentDetailView>> {
    const result = await this.commandBus.execute<
      AdjustLateFeeCommand,
      InstallmentDetailView
    >(new AdjustLateFeeCommand(id, dto.kind, dto.amount ?? null, dto.reason))
    return { success: true, message: 'Punitorio ajustado', data: result }
  }

  @Get('payments')
  @ApiOperation({
    summary: 'Listar pagos',
    description:
      'Filtros por contrato, inquilino, estado (pendientes de confirmación), quién lo recibió y rango de fechas de pago.',
  })
  @ApiPaginatedResponse(PaymentListItemDto, 'Pagos de la inmobiliaria')
  async listPayments(
    @Query() query: ListPaymentsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<PaymentListItemView>>> {
    const result = await this.queryBus.execute<
      ListPaymentsQuery,
      PaginatedResult<PaymentListItemView>
    >(
      new ListPaymentsQuery(
        {
          contractId: query.contractId,
          renterId: query.renterId,
          status: query.status,
          receivedBy: query.receivedBy,
          from: query.from,
          to: query.to,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Post('payments/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirmar un pago informado por el propietario',
    description: 'No cambia saldos (A-11): es control interno.',
  })
  @ApiResponse({ status: 200, type: PaymentDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'Ya confirmado o anulado',
    type: ApiErrorDto,
  })
  async confirmPayment(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<PaymentView>> {
    const result = await this.commandBus.execute<
      ConfirmPaymentCommand,
      PaymentView
    >(new ConfirmPaymentCommand(id))
    return { success: true, message: 'Pago confirmado', data: result }
  }

  @Post('payments/:id/void')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Anular un pago (sólo admin)',
    description:
      'Deja de contar en todo y la cuota se recalcula. El saldo a favor que generó tiene que estar sin usar; anular una aplicación de crédito devuelve el monto al crédito.',
  })
  @ApiResponse({ status: 200, type: InstallmentDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'Ya anulado, o el crédito que generó ya se usó',
    type: ApiErrorDto,
  })
  async voidPayment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VoidDto,
  ): Promise<ApiSuccessDto<InstallmentDetailView>> {
    const result = await this.commandBus.execute<
      VoidPaymentCommand,
      InstallmentDetailView
    >(new VoidPaymentCommand(id, dto.reason))
    return { success: true, message: 'Pago anulado', data: result }
  }

  @Get('renters/:renterId/credits')
  @ApiOperation({
    summary: 'Saldos a favor de un inquilino',
    description:
      'Disponibles, aplicados, devueltos y anulados, con el total disponible por moneda.',
  })
  @ApiResponse({ status: 200, type: RenterCreditsDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async listCredits(
    @Param('renterId', new ParseUUIDPipe()) renterId: string,
  ): Promise<ApiSuccessDto<RenterCreditsView>> {
    const result = await this.queryBus.execute<
      ListRenterCreditsQuery,
      RenterCreditsView
    >(new ListRenterCreditsQuery(renterId))
    return { success: true, message: null, data: result }
  }

  @Post('credits/:id/refund')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Devolver un saldo a favor (sólo admin)',
    description:
      'Registra la devolución: fecha, medio y notas. Sólo un crédito disponible.',
  })
  @ApiResponse({ status: 200, type: RenterCreditDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'El crédito no está disponible',
    type: ApiErrorDto,
  })
  async refundCredit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RefundCreditDto,
  ): Promise<ApiSuccessDto<RenterCreditView>> {
    const result = await this.commandBus.execute<
      RefundCreditCommand,
      RenterCreditView
    >(
      new RefundCreditCommand(
        id,
        dto.refundedAt,
        dto.method,
        dto.notes ?? null,
      ),
    )
    return { success: true, message: 'Saldo a favor devuelto', data: result }
  }

  @Get('arrears')
  @ApiOperation({
    summary: 'Mora por inquilino',
    description:
      '`?renterId=a&renterId=b` o `?renterIds=a,b`. Una fila por id pedido aunque no tenga cuotas (UP_TO_DATE). Para badges en listados y fichas.',
  })
  @ApiResponse({ status: 200, type: [RenterArrearsDto] })
  async arrears(
    @Query() query: ArrearsQueryDto,
  ): Promise<ApiSuccessDto<RenterArrearsView[]>> {
    const result = await this.queryBus.execute<
      GetArrearsQuery,
      RenterArrearsView[]
    >(
      new GetArrearsQuery([
        ...(query.renterId ?? []),
        ...(query.renterIds ?? []),
      ]),
    )
    return { success: true, message: null, data: result }
  }
}
