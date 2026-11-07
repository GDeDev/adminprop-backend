import { Controller, Get, Query, Res } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Response } from 'express'

import { Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { Attachment, sendAttachment } from '@/shared/files/attachment'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  ExportRequest,
  ReportFormat,
} from '../../../application/report-export.service'
import {
  ExportReportQuery,
  GetArrearsReportQuery,
  GetDashboardReportQuery,
  GetExpiringContractsReportQuery,
  GetIncomeReportQuery,
  GetPaymentsReportQuery,
  GetPropertiesReportQuery,
  GetServicesReportQuery,
} from '../../../application/reports.queries'
import {
  ArrearsQueryDto,
  ArrearsReportDto,
  DashboardQueryDto,
  DashboardReportDto,
  ExpiringContractsReportDto,
  ExpiringQueryDto,
  IncomeReportDto,
  PaymentReportRowDto,
  PaymentsQueryDto,
  PropertiesQueryDto,
  PropertiesReportDto,
  RangeQueryDto,
  ServicesQueryDto,
  ServicesReportDto,
} from '../dtos/reports.dtos'

const FILE_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/pdf',
]
const FILE_RESPONSE = {
  description:
    'Con `?format=`, el archivo (Content-Disposition) en vez de JSON',
}

/**
 * Estadísticas y reportes (Fase 19). Sólo lectura, para admin y empleado.
 * Cada ruta compone las facades de los módulos dueños de los datos y devuelve
 * el importe siempre por moneda. Con `?format=xlsx|csv|pdf` responde el
 * archivo con los mismos filtros y deja la exportación en la auditoría.
 */
@ApiTags('Reports')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller({ path: 'reports' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class ReportsController {
  constructor(private readonly queryBus: QueryBus) {}

  /** JSON, o el archivo si el pedido trae `format`. */
  private async respond<T>(
    res: Response,
    format: ReportFormat | undefined,
    request: ExportRequest,
    json: () => Promise<T>,
  ): Promise<void> {
    if (format) {
      sendAttachment(
        res,
        await this.queryBus.execute<ExportReportQuery, Attachment>(
          new ExportReportQuery(request, format),
        ),
      )
      return
    }
    const body: ApiSuccessDto<T> = {
      success: true,
      message: null,
      data: await json(),
    }
    res.json(body)
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'Dashboard del mes',
    description:
      'Cuotas por estado, punitorios y honorarios del mes (por moneda), pendientes del día, contratos por vencer y los últimos 6 meses.',
  })
  @ApiResponse({ status: 200, type: DashboardReportDto })
  async dashboard(
    @Query() query: DashboardQueryDto,
  ): Promise<ApiSuccessDto<DashboardReportDto>> {
    const data = await this.queryBus.execute<
      GetDashboardReportQuery,
      DashboardReportDto
    >(new GetDashboardReportQuery(query.period))
    return { success: true, message: null, data }
  }

  @Get('financial/income')
  @ApiOperation({
    summary: 'Ingresos, honorarios y punitorios por mes',
    description:
      'Una fila por mes y moneda. Lo cobrado se cuenta por fecha de pago; honorarios y neto, por el mes de la liquidación.',
  })
  @ApiProduces('application/json', ...FILE_TYPES)
  @ApiOkResponse({ ...FILE_RESPONSE, type: IncomeReportDto })
  async income(
    @Query() query: RangeQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.respond(
      res,
      query.format,
      { report: 'income', from: query.from, to: query.to },
      () =>
        this.queryBus.execute<GetIncomeReportQuery, IncomeReportDto>(
          new GetIncomeReportQuery(query.from, query.to),
        ),
    )
  }

  @Get('financial/payments')
  @ApiOperation({
    summary: 'Pagos recibidos',
    description:
      'Pagos confirmados del período, más nuevos primero, con cuota, inquilino, propiedad, propietario, medio y quién recibió. Paginado; con `format`, todos.',
  })
  @ApiProduces('application/json', ...FILE_TYPES)
  @ApiPaginatedResponse(PaymentReportRowDto, FILE_RESPONSE.description)
  async payments(
    @Query() query: PaymentsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { page, limit, format, ...filter } = query
    await this.respond(res, format, { report: 'payments', ...filter }, () =>
      this.queryBus.execute(
        new GetPaymentsReportQuery(filter, { page, limit }),
      ),
    )
  }

  @Get('financial/arrears')
  @ApiOperation({
    summary: 'Alquileres vencidos',
    description:
      'Inquilinos con deuda a la fecha: cuotas vencidas, días de atraso, saldo y punitorio por moneda, y teléfono.',
  })
  @ApiProduces('application/json', ...FILE_TYPES)
  @ApiOkResponse({ ...FILE_RESPONSE, type: ArrearsReportDto })
  async arrears(
    @Query() query: ArrearsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.respond(
      res,
      query.format,
      { report: 'arrears', asOf: query.asOf, minDays: query.minDays },
      () =>
        this.queryBus.execute<GetArrearsReportQuery, ArrearsReportDto>(
          new GetArrearsReportQuery(query.asOf, query.minDays),
        ),
    )
  }

  @Get('operations/properties')
  @ApiOperation({
    summary: 'Propiedades alquiladas o disponibles',
    description:
      'Las alquiladas con inquilino, alquiler y fin del contrato; las disponibles con los días sin alquilar.',
  })
  @ApiProduces('application/json', ...FILE_TYPES)
  @ApiOkResponse({ ...FILE_RESPONSE, type: PropertiesReportDto })
  async properties(
    @Query() query: PropertiesQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.respond(
      res,
      query.format,
      { report: 'properties', status: query.status },
      () =>
        this.queryBus.execute<GetPropertiesReportQuery, PropertiesReportDto>(
          new GetPropertiesReportQuery(query.status),
        ),
    )
  }

  @Get('operations/expiring-contracts')
  @ApiOperation({
    summary: 'Contratos por vencer',
    description:
      'Los activos que terminan dentro de `withinDays` (default: los días de aviso de la inmobiliaria), con si hay renovación en curso.',
  })
  @ApiProduces('application/json', ...FILE_TYPES)
  @ApiOkResponse({ ...FILE_RESPONSE, type: ExpiringContractsReportDto })
  async expiring(
    @Query() query: ExpiringQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.respond(
      res,
      query.format,
      { report: 'expiring-contracts', withinDays: query.withinDays },
      () =>
        this.queryBus.execute<
          GetExpiringContractsReportQuery,
          ExpiringContractsReportDto
        >(new GetExpiringContractsReportQuery(query.withinDays)),
    )
  }

  @Get('operations/services')
  @ApiOperation({
    summary: 'Servicios vencidos',
    description:
      'Servicios de propiedades con vencimiento pasado y sus días de atraso.',
  })
  @ApiProduces('application/json', ...FILE_TYPES)
  @ApiOkResponse({ ...FILE_RESPONSE, type: ServicesReportDto })
  async services(
    @Query() query: ServicesQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.respond(
      res,
      query.format,
      { report: 'services', status: query.status },
      () =>
        this.queryBus.execute<GetServicesReportQuery, ServicesReportDto>(
          new GetServicesReportQuery(query.status),
        ),
    )
  }
}
