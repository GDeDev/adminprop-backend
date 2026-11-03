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
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult, PaginationQueryDto } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  AppraisePropertyCommand,
  GetMarketCoverageQuery,
  GetMarketStatusQuery,
  ListAppraisalsQuery,
  RefreshZoneCommand,
} from '../../../application/valuation.commands'
import {
  MarketCoverageView,
  MarketStatusView,
  ValuationView,
} from '../../../application/valuation.views'
import {
  AppraisePropertyDto,
  MarketCoverageDto,
  MarketCoverageQueryDto,
  MarketStatusDto,
  RefreshZoneDto,
  RefreshZoneResultDto,
  ValuationResultDto,
} from '../dtos/valuation.dtos'

/**
 * Tasación automática de alquiler (spec Fase 24, rediseño 6). Admin y
 * empleado; propietarios e inquilinos reciben 403. La tasación es una
 * sugerencia: ningún endpoint toca el precio de la propiedad.
 */
@ApiTags('Valuation')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller('valuation')
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class ValuationController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('properties/:propertyId/appraise')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Sugerir un rango de alquiler',
    description:
      'Síncrono: consulta sólo el caché de avisos, sin red. Devuelve 201 también cuando `reused` es true (una tasación idéntica de las últimas 6 horas). 422 `INSUFFICIENT_MARKET_DATA` si no hay avisos suficientes; 429 `VALUATION_DAILY_LIMIT`. No modifica la propiedad. Auditado.',
  })
  @ApiResponse({ status: 201, type: ValuationResultDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  @ApiResponse({ status: 429, type: ApiErrorDto })
  async appraise(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() dto: AppraisePropertyDto,
  ): Promise<ApiSuccessDto<ValuationView>> {
    const data = await this.commandBus.execute<
      AppraisePropertyCommand,
      ValuationView
    >(new AppraisePropertyCommand(propertyId, dto))
    return { success: true, message: 'Tasación calculada', data }
  }

  @Get('properties/:propertyId/history')
  @ApiOperation({
    summary: 'Historial de tasaciones de una propiedad, las nuevas primero',
  })
  @ApiPaginatedResponse(ValuationResultDto, 'Tasaciones de la propiedad')
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async history(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<ValuationView>>> {
    const data = await this.queryBus.execute<
      ListAppraisalsQuery,
      PaginatedResult<ValuationView>
    >(new ListAppraisalsQuery(propertyId, query))
    return { success: true, message: null, data }
  }

  @Get('market-status')
  @ApiOperation({
    summary: 'Estado de las fuentes de datos de mercado',
    description:
      'Por fuente: último ingreso, estado y avisos vigentes. Son datos de mercado agregados, iguales para todas las inmobiliarias.',
  })
  @ApiResponse({ status: 200, type: MarketStatusDto })
  async marketStatus(): Promise<ApiSuccessDto<MarketStatusView>> {
    const data = await this.queryBus.execute<
      GetMarketStatusQuery,
      MarketStatusView
    >(new GetMarketStatusQuery())
    return { success: true, message: null, data }
  }

  @Get('market-coverage')
  @ApiOperation({
    summary: 'Avisos vigentes de la zona de una ubicación',
    description:
      'Para anticipar el 422 antes de tasar. No distingue categoría ni moneda: es una cobertura orientativa.',
  })
  @ApiResponse({ status: 200, type: MarketCoverageDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async marketCoverage(
    @Query() query: MarketCoverageQueryDto,
  ): Promise<ApiSuccessDto<MarketCoverageView>> {
    const data = await this.queryBus.execute<
      GetMarketCoverageQuery,
      MarketCoverageView
    >(new GetMarketCoverageQuery(query.locationId))
    return { success: true, message: null, data }
  }

  @Post('zones/refresh')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Refrescar los avisos de la zona de una ubicación (admin)',
    description:
      'Se encola y responde 202 con el id del trabajo (`GET /jobs/:id/status`). Respeta el máximo de una corrida por zona cada 24 h.',
  })
  @ApiResponse({ status: 202, type: RefreshZoneResultDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async refreshZone(
    @Body() dto: RefreshZoneDto,
  ): Promise<ApiSuccessDto<{ jobId: string }>> {
    const data = await this.commandBus.execute<
      RefreshZoneCommand,
      { jobId: string }
    >(new RefreshZoneCommand(dto.locationId))
    return { success: true, message: 'Actualización de la zona en cola', data }
  }
}
