import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Response } from 'express'

import { CurrentUser, Role, Roles } from '@/modules/auth/public'
import { InstallmentSummaryView } from '@/modules/billing/public'
import { AcknowledgeSettlementCommand } from '@/modules/portal/application/commands/acknowledge-settlement.handler'
import {
  GetOwnerAccountQuery,
  GetOwnerMeQuery,
  GetOwnerSettlementPdfUrlQuery,
  GetOwnerSettlementQuery,
  GetOwnerStatementPdfUrlQuery,
  GetOwnerStatementQuery,
  ListOwnerPropertiesQuery,
  ListOwnerPropertyInstallmentsQuery,
  ListOwnerSettlementsQuery,
  ListOwnerStatementsQuery,
} from '@/modules/portal/application/queries/owner-portal.queries'
import {
  PortalOwnerAccountView,
  PortalOwnerMeView,
  PortalOwnerPropertyView,
} from '@/modules/portal/application/portal.views'
import {
  OwnerStatementDetailView,
  OwnerStatementSummaryView,
  SettlementDetailView,
  SettlementSummaryView,
} from '@/modules/settlements/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import {
  ApiOkRef,
  ApiPagedRef,
  PortalOwnerAccountDto,
  PortalOwnerAccountQueryDto,
  PortalOwnerMeDto,
  PortalOwnerPropertyDto,
  PortalOwnerSettlementsQueryDto,
  PortalPdfQueryDto,
} from '../dtos/portal.dtos'
import { sendPdf } from './pdf-response'

/**
 * Portal del propietario (Fase 17). Lectura, salvo el acuse de recibo de una
 * transferencia (A-37). Cada handler resuelve primero al propietario del
 * usuario logueado y filtra todo por su id: lo ajeno responde 404.
 */
@ApiTags('Portal del propietario')
@ApiBearerAuth()
@Roles(Role.OWNER)
@Controller({ path: 'portal/owner' })
@ApiResponse({
  status: 403,
  description: 'No es un usuario propietario',
  type: ApiErrorDto,
})
export class PortalOwnerController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Mis datos y los de la inmobiliaria',
    description:
      'Nombre, email, su cuenta bancaria registrada (para que confirme que es correcta), el modo de envío de resúmenes y los datos de la inmobiliaria.',
  })
  @ApiResponse({ status: 200, type: PortalOwnerMeDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async me(
    @CurrentUser('id') userId: string,
  ): Promise<ApiSuccessDto<PortalOwnerMeView>> {
    const data = await this.queryBus.execute<
      GetOwnerMeQuery,
      PortalOwnerMeView
    >(new GetOwnerMeQuery(userId))
    return { success: true, message: null, data }
  }

  @Get('properties')
  @ApiOperation({
    summary: 'Mis propiedades',
    description:
      'Con el contrato activo (inquilino, fechas, alquiler vigente) y el estado de pago de la cuota del mes.',
  })
  @ApiResponse({ status: 200, type: [PortalOwnerPropertyDto] })
  async properties(
    @CurrentUser('id') userId: string,
  ): Promise<ApiSuccessDto<PortalOwnerPropertyView[]>> {
    const data = await this.queryBus.execute<
      ListOwnerPropertiesQuery,
      PortalOwnerPropertyView[]
    >(new ListOwnerPropertiesQuery(userId))
    return { success: true, message: null, data }
  }

  @Get('properties/:propertyId/installments')
  @ApiOperation({
    summary: 'Pagos del inquilino de una propiedad',
    description:
      'Las cuotas de la propiedad con estado, pagado y fecha. Sin el detalle de medios de pago ni quién registró. Una propiedad ajena es un 404.',
  })
  @ApiPagedRef('InstallmentSummaryDto', 'Cuotas de la propiedad')
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async propertyInstallments(
    @CurrentUser('id') userId: string,
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<InstallmentSummaryView>>> {
    const data = await this.queryBus.execute<
      ListOwnerPropertyInstallmentsQuery,
      PaginatedResult<InstallmentSummaryView>
    >(
      new ListOwnerPropertyInstallmentsQuery(userId, propertyId, {
        page: query.page,
        limit: query.limit,
      }),
    )
    return { success: true, message: null, data }
  }

  @Get('account')
  @ApiOperation({
    summary: 'Estado de cuenta del mes',
    description:
      'Por propiedad: alquiler devengado, cobrado, pendiente, punitorio y las liquidaciones del mes. Más los totales por moneda y su cuenta de honorarios con la inmobiliaria. Sin honorarios de otros propietarios ni totales de la inmobiliaria.',
  })
  @ApiResponse({ status: 200, type: PortalOwnerAccountDto })
  async account(
    @CurrentUser('id') userId: string,
    @Query() query: PortalOwnerAccountQueryDto,
  ): Promise<ApiSuccessDto<PortalOwnerAccountView>> {
    const data = await this.queryBus.execute<
      GetOwnerAccountQuery,
      PortalOwnerAccountView
    >(new GetOwnerAccountQuery(userId, query.period))
    return { success: true, message: null, data }
  }

  @Get('settlements')
  @ApiOperation({
    summary: 'Historial de liquidaciones',
    description:
      'Sólo las confirmadas o transferidas (A-36), las más nuevas primero. Filtros por propiedad y mes.',
  })
  @ApiPagedRef('SettlementSummaryDto', 'Liquidaciones del propietario')
  async settlements(
    @CurrentUser('id') userId: string,
    @Query() query: PortalOwnerSettlementsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<SettlementSummaryView>>> {
    const data = await this.queryBus.execute<
      ListOwnerSettlementsQuery,
      PaginatedResult<SettlementSummaryView>
    >(
      new ListOwnerSettlementsQuery(
        userId,
        { propertyId: query.propertyId, period: query.period },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data }
  }

  @Get('settlements/:id')
  @ApiOperation({
    summary: 'Detalle de una liquidación',
    description:
      'Con pagos, honorarios, gastos, ajustes y transferencias; `acknowledgedAt` si ya acusó recibo. Sin quién registró cada cosa ni notas internas.',
  })
  @ApiOkRef('SettlementDetailDto', 'Detalle de la liquidación')
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async settlement(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<SettlementDetailView>> {
    const data = await this.queryBus.execute<
      GetOwnerSettlementQuery,
      SettlementDetailView
    >(new GetOwnerSettlementQuery(userId, id))
    return { success: true, message: null, data }
  }

  @Get('settlements/:id/pdf')
  @ApiOperation({
    summary: 'PDF de una liquidación',
    description:
      'Redirige (302) al PDF vigente. 404 `DOCUMENT_NOT_READY` si todavía no se generó. Con `?format=json` responde `{ url }` en lugar de redirigir.',
  })
  @ApiResponse({ status: 302, description: 'Redirige al PDF' })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async settlementPdf(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PortalPdfQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const url = await this.queryBus.execute<
      GetOwnerSettlementPdfUrlQuery,
      string
    >(new GetOwnerSettlementPdfUrlQuery(userId, id))
    sendPdf(response, url, query.format)
  }

  @Post('settlements/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recibí la transferencia',
    description:
      'La única escritura del portal (A-37): deja constancia de cuándo el propietario confirmó que recibió la transferencia. Idempotente. 422 `SETTLEMENT_NOTHING_TO_ACKNOWLEDGE` si todavía no se le transfirió nada.',
  })
  @ApiOkRef('SettlementDetailDto', 'La liquidación con `acknowledgedAt`')
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async acknowledge(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<SettlementDetailView>> {
    const data = await this.commandBus.execute<
      AcknowledgeSettlementCommand,
      SettlementDetailView
    >(new AcknowledgeSettlementCommand(userId, id))
    return { success: true, message: 'Recepción confirmada', data }
  }

  @Get('statements')
  @ApiOperation({
    summary: 'Resúmenes mensuales',
    description: 'Los consolidados cerrados, los más nuevos primero.',
  })
  @ApiPagedRef('OwnerStatementSummaryDto', 'Resúmenes del propietario')
  async statements(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<OwnerStatementSummaryView>>> {
    const data = await this.queryBus.execute<
      ListOwnerStatementsQuery,
      PaginatedResult<OwnerStatementSummaryView>
    >(
      new ListOwnerStatementsQuery(userId, {
        page: query.page,
        limit: query.limit,
      }),
    )
    return { success: true, message: null, data }
  }

  @Get('statements/:id')
  @ApiOperation({ summary: 'Detalle de un resumen mensual' })
  @ApiOkRef('OwnerStatementDetailDto', 'Detalle del resumen')
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async statement(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<OwnerStatementDetailView>> {
    const data = await this.queryBus.execute<
      GetOwnerStatementQuery,
      OwnerStatementDetailView
    >(new GetOwnerStatementQuery(userId, id))
    return { success: true, message: null, data }
  }

  @Get('statements/:id/pdf')
  @ApiOperation({
    summary: 'PDF de un resumen mensual',
    description:
      'Redirige (302) al PDF vigente. 404 `DOCUMENT_NOT_READY` si todavía no se generó. Con `?format=json` responde `{ url }` en lugar de redirigir.',
  })
  @ApiResponse({ status: 302, description: 'Redirige al PDF' })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async statementPdf(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PortalPdfQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const url = await this.queryBus.execute<
      GetOwnerStatementPdfUrlQuery,
      string
    >(new GetOwnerStatementPdfUrlQuery(userId, id))
    sendPdf(response, url, query.format)
  }
}
