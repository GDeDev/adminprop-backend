import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Response } from 'express'

import {
  InstallmentDetailView,
  InstallmentSummaryView,
} from '@/modules/billing/public'
import { CurrentUser, Role, Roles } from '@/modules/auth/public'
import {
  GetRenterAccountQuery,
  GetRenterContractQuery,
  GetRenterInstallmentQuery,
  GetRenterMeQuery,
  GetRenterReceiptUrlQuery,
  ListRenterInstallmentsQuery,
} from '@/modules/portal/application/queries/renter-portal.queries'
import {
  PortalRenterAccountView,
  PortalRenterContractView,
  PortalRenterMeView,
} from '@/modules/portal/application/portal.views'
import { StoragePort } from '@/platform/storage/storage.port'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import {
  ApiOkRef,
  ApiPagedRef,
  PortalPdfQueryDto,
  PortalPdfUrlDto,
  PortalRenterAccountDto,
  PortalRenterContractDto,
  PortalRenterMeDto,
} from '../dtos/portal.dtos'
import { sendPdf } from './pdf-response'

/**
 * Portal del inquilino (Fase 18). Sólo lectura. Cada handler resuelve primero
 * al inquilino del usuario logueado y filtra todo por su id: lo ajeno responde
 * 404, como si no existiera.
 */
@ApiTags('Portal del inquilino')
@ApiBearerAuth()
@ApiExtraModels(PortalPdfUrlDto)
@Roles(Role.RENTER)
@Controller({ path: 'portal/renter' })
@ApiResponse({
  status: 403,
  description: 'No es un usuario inquilino',
  type: ApiErrorDto,
})
export class PortalRenterController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly storage: StoragePort,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Mis datos y los de la inmobiliaria',
    description:
      'Nombre, email y teléfono del inquilino; la inmobiliaria con logo, color, contacto, WhatsApp y datos bancarios para pagar.',
  })
  @ApiResponse({ status: 200, type: PortalRenterMeDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async me(
    @CurrentUser('id') userId: string,
  ): Promise<ApiSuccessDto<PortalRenterMeView>> {
    const data = await this.queryBus.execute<
      GetRenterMeQuery,
      PortalRenterMeView
    >(new GetRenterMeQuery(userId))
    return { success: true, message: null, data }
  }

  @Get('contract')
  @ApiOperation({
    summary: 'Mi contrato',
    description:
      'El contrato activo o, si no tiene, el último (A-35). `data: null` si nunca tuvo uno. Los honorarios sólo se muestran si los paga él por cuenta del propietario (A-38).',
  })
  @ApiResponse({ status: 200, type: PortalRenterContractDto })
  async contract(
    @CurrentUser('id') userId: string,
  ): Promise<ApiSuccessDto<PortalRenterContractView | null>> {
    const data = await this.queryBus.execute<
      GetRenterContractQuery,
      PortalRenterContractView | null
    >(new GetRenterContractQuery(userId))
    return { success: true, message: null, data }
  }

  @Get('account')
  @ApiOperation({
    summary: 'Estado de cuenta',
    description:
      'La cuota del mes con el punitorio a hoy día por día, el saldo a favor disponible, la mora y cómo pagar (datos de la inmobiliaria o pago directo al propietario).',
  })
  @ApiResponse({ status: 200, type: PortalRenterAccountDto })
  async account(
    @CurrentUser('id') userId: string,
  ): Promise<ApiSuccessDto<PortalRenterAccountView>> {
    const data = await this.queryBus.execute<
      GetRenterAccountQuery,
      PortalRenterAccountView
    >(new GetRenterAccountQuery(userId))
    return { success: true, message: null, data }
  }

  @Get('installments')
  @ApiOperation({
    summary: 'Historial de cuotas',
    description:
      'Todas sus cuotas, de todos sus contratos, las más nuevas primero.',
  })
  @ApiPagedRef('InstallmentSummaryDto', 'Cuotas del inquilino')
  async installments(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<InstallmentSummaryView>>> {
    const data = await this.queryBus.execute<
      ListRenterInstallmentsQuery,
      PaginatedResult<InstallmentSummaryView>
    >(
      new ListRenterInstallmentsQuery(userId, {
        page: query.page,
        limit: query.limit,
      }),
    )
    return { success: true, message: null, data }
  }

  @Get('installments/:id')
  @ApiOperation({
    summary: 'Detalle de una cuota',
    description:
      'Con sus pagos y el punitorio día por día. Sin quién registró, notas internas ni la liquidación al propietario. Una cuota de otro inquilino es un 404.',
  })
  @ApiOkRef('InstallmentDetailDto', 'Detalle de la cuota')
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async installment(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<InstallmentDetailView>> {
    const data = await this.queryBus.execute<
      GetRenterInstallmentQuery,
      InstallmentDetailView
    >(new GetRenterInstallmentQuery(userId, id))
    return { success: true, message: null, data }
  }

  @Get('payments/:id/receipt')
  @ApiOperation({
    summary: 'Recibo PDF de un pago',
    description:
      'Redirige (302) al PDF del recibo. 404 `DOCUMENT_NOT_READY` si todavía no se generó; 404 `PAYMENT_NOT_FOUND` si el pago no es suyo. Con `?format=json` responde `{ url }` en lugar de redirigir.',
  })
  @ApiResponse({ status: 302, description: 'Redirige al PDF' })
  @ApiOkRef('PortalPdfUrlDto', 'La URL del PDF (con ?format=json)')
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async receipt(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: PortalPdfQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const url = await this.queryBus.execute<GetRenterReceiptUrlQuery, string>(
      new GetRenterReceiptUrlQuery(userId, id),
    )
    sendPdf(response, this.storage.signUrl(url), query.format)
  }
}
