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
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { Role, Roles } from '@/modules/auth/public'
import { GenerateInstallmentsCommand } from '@/modules/billing/application/commands/billing.commands'
import { ContractAccountView } from '@/modules/billing/application/contract-account.views'
import { GenerationResult } from '@/modules/billing/application/installment-generator'
import {
  BillingSummaryView,
  InstallmentBreakdownView,
  InstallmentDetailView,
  InstallmentSummaryView,
} from '@/modules/billing/application/installment.views'
import {
  GetBillingSummaryQuery,
  GetContractAccountQuery,
  GetInstallmentBreakdownQuery,
  GetInstallmentQuery,
  ListInstallmentsQuery,
} from '@/modules/billing/application/queries/billing.queries'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  BillingSummaryDto,
  BillingSummaryQueryDto,
  ContractAccountDto,
  GenerateInstallmentsDto,
  InstallmentBreakdownDto,
  InstallmentBreakdownQueryDto,
  InstallmentDetailDto,
  InstallmentGenerationResultDto,
  InstallmentSummaryDto,
  ListInstallmentsQueryDto,
} from '../dtos/billing.dtos'

/**
 * Cuotas (spec Fase 11, rediseño 5). Admin y empleado. Las rutas son
 * absolutas: `/billing/...` y la cuenta corriente colgada de contratos
 * (contratos no conoce a cobros).
 */
@ApiTags('Billing')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller()
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class InstallmentsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('billing/installments/generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generar las cuotas de un mes (idempotente)',
    description:
      'Una cuota por contrato activo que cubre el mes, con el alquiler vigente y los términos de cobro copiados. Sin `period`, el mes siguiente. Correrlo dos veces no duplica.',
  })
  @ApiResponse({ status: 200, type: InstallmentGenerationResultDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  async generate(
    @Body() dto: GenerateInstallmentsDto,
  ): Promise<ApiSuccessDto<GenerationResult>> {
    const result = await this.commandBus.execute<
      GenerateInstallmentsCommand,
      GenerationResult
    >(new GenerateInstallmentsCommand(dto.period ?? null))
    return {
      success: true,
      message: `Cuotas de ${result.period}: ${result.created} nuevas, ${result.skipped} ya existían`,
      data: result,
    }
  }

  @Get('billing/installments')
  @ApiOperation({
    summary: 'Listar cuotas con saldos a hoy',
    description:
      'Filtros por mes, estado (OVERDUE calculado), contrato, inquilino, propiedad, propietario y modalidad de cobro.',
  })
  @ApiPaginatedResponse(InstallmentSummaryDto, 'Cuotas de la inmobiliaria')
  async list(
    @Query() query: ListInstallmentsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<InstallmentSummaryView>>> {
    const result = await this.queryBus.execute<
      ListInstallmentsQuery,
      PaginatedResult<InstallmentSummaryView>
    >(
      new ListInstallmentsQuery(
        {
          period: query.period,
          status: query.status,
          contractId: query.contractId,
          renterId: query.renterId,
          propertyId: query.propertyId,
          ownerId: query.ownerId,
          collectionMode: query.collectionMode,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Get('billing/installments/summary')
  @ApiOperation({
    summary: 'Resumen del mes por moneda',
    description:
      'Cantidades por estado, base, cargos, cobrado (por quién lo recibió), punitorio devengado y cobrado, honorarios devengados y saldo.',
  })
  @ApiResponse({ status: 200, type: BillingSummaryDto })
  async summary(
    @Query() query: BillingSummaryQueryDto,
  ): Promise<ApiSuccessDto<BillingSummaryView>> {
    const result = await this.queryBus.execute<
      GetBillingSummaryQuery,
      BillingSummaryView
    >(new GetBillingSummaryQuery(query.period))
    return { success: true, message: null, data: result }
  }

  @Get('billing/installments/:id')
  @ApiOperation({
    summary: 'Ficha de la cuota',
    description:
      'Saldos a hoy, cargos, pagos (con cotización e imputación), ajustes del punitorio, detalle diario y saldo a favor disponible.',
  })
  @ApiResponse({ status: 200, type: InstallmentDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<InstallmentDetailView>> {
    const result = await this.queryBus.execute<
      GetInstallmentQuery,
      InstallmentDetailView
    >(new GetInstallmentQuery(id))
    return { success: true, message: null, data: result }
  }

  @Get('billing/installments/:id/breakdown')
  @ApiOperation({
    summary: 'Desglose a una fecha',
    description:
      'Base, cargos, días y punitorio, pagado por concepto, saldos, crédito disponible y total a pagar, recalculados a `asOf` (default hoy).',
  })
  @ApiResponse({ status: 200, type: InstallmentBreakdownDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async breakdown(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: InstallmentBreakdownQueryDto,
  ): Promise<ApiSuccessDto<InstallmentBreakdownView>> {
    const result = await this.queryBus.execute<
      GetInstallmentBreakdownQuery,
      InstallmentBreakdownView
    >(new GetInstallmentBreakdownQuery(id, query.asOf))
    return { success: true, message: null, data: result }
  }

  @Get('contracts/:contractId/account')
  @ApiOperation({
    summary: 'Cuenta corriente del contrato',
    description:
      'Totales, cuotas y movimientos cronológicos (devengado, cargos, punitorio, pagos, saldos a favor, anulaciones) más el depósito con su devolución sugerida. El contrato puede estar en cualquier estado.',
  })
  @ApiResponse({ status: 200, type: ContractAccountDto })
  @ApiResponse({
    status: 422,
    description: 'El contrato no existe',
    type: ApiErrorDto,
  })
  async account(
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
  ): Promise<ApiSuccessDto<ContractAccountView>> {
    const result = await this.queryBus.execute<
      GetContractAccountQuery,
      ContractAccountView
    >(new GetContractAccountQuery(contractId))
    return { success: true, message: null, data: result }
  }
}
