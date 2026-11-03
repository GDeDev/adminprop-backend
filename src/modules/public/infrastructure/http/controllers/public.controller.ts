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
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'

import { IsPublic } from '@/modules/auth/public'
import {
  PublicFiltersView,
  PublicPropertyDetailView,
  PublicPropertySummaryView,
} from '@/modules/properties/public'
import { RequestContext } from '@/shared/context/request-context'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import { SubmitPublicInquiryCommand } from '../../../application/public.commands'
import {
  GetPublicFiltersQuery,
  GetPublicPropertyQuery,
  ListPublicPropertiesQuery,
} from '../../../application/public.queries'
import {
  PublicContactDto,
  PublicContactResultDto,
  PublicFiltersDto,
  PublicListingQueryDto,
  PublicPropertyDetailDto,
  PublicPropertySummaryDto,
} from '../dtos/public.dtos'

/** Lecturas: 60 por minuto por IP (Fase 22, 2). Pisa sólo el perfil `medium`. */
const READ_LIMIT = { medium: { limit: 60, ttl: 60_000 } }
/**
 * Formulario: el tope exacto (5 por hora por IP y por email) lo cuenta el
 * handler contra la base; esto frena además a los bots del honeypot, que no
 * dejan fila: 20 envíos por hora por IP.
 */
const CONTACT_LIMIT = { long: { limit: 20, ttl: 3_600_000 } }

/**
 * Portal público (Fase 22): sin JWT, la inmobiliaria sale del `slug` de la
 * ruta. Sólo propiedades disponibles y sólo datos aptos para el público.
 */
@ApiTags('Public')
@IsPublic()
@Controller({ path: 'public/:slug' })
@ApiParam({ name: 'slug', example: 'oppido' })
@ApiResponse({
  status: 404,
  description: 'La inmobiliaria no existe o está deshabilitada',
  type: ApiErrorDto,
})
@ApiResponse({
  status: 429,
  description: 'Demasiadas solicitudes',
  type: ApiErrorDto,
})
export class PublicController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('properties')
  @Throttle(READ_LIMIT)
  @ApiOperation({ summary: 'Propiedades disponibles, con filtros' })
  @ApiPaginatedResponse(
    PublicPropertySummaryDto,
    'Propiedades disponibles, más nuevas primero',
  )
  async list(
    @Param('slug') slug: string,
    @Query() query: PublicListingQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<PublicPropertySummaryView>>> {
    const result = await this.queryBus.execute<
      ListPublicPropertiesQuery,
      PaginatedResult<PublicPropertySummaryView>
    >(
      new ListPublicPropertiesQuery(
        slug,
        {
          locationId: query.locationId,
          propertyTypeId: query.propertyTypeId,
          priceFrom: query.priceFrom,
          priceTo: query.priceTo,
          currency: query.currency,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Get('properties/:id')
  @Throttle(READ_LIMIT)
  @ApiOperation({ summary: 'Ficha pública de una propiedad disponible' })
  @ApiResponse({ status: 200, type: PublicPropertyDetailDto })
  @ApiResponse({
    status: 404,
    description: 'PROPERTY_NOT_AVAILABLE: no existe o ya no está disponible',
    type: ApiErrorDto,
  })
  async findOne(
    @Param('slug') slug: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<PublicPropertyDetailView>> {
    const property = await this.queryBus.execute<
      GetPublicPropertyQuery,
      PublicPropertyDetailView
    >(new GetPublicPropertyQuery(slug, id))
    return { success: true, message: null, data: property }
  }

  @Get('filters')
  @Throttle(READ_LIMIT)
  @ApiOperation({
    summary: 'Tipos y ubicaciones en uso por propiedades disponibles',
  })
  @ApiResponse({ status: 200, type: PublicFiltersDto })
  async filters(
    @Param('slug') slug: string,
  ): Promise<ApiSuccessDto<PublicFiltersView>> {
    const filters = await this.queryBus.execute<
      GetPublicFiltersQuery,
      PublicFiltersView
    >(new GetPublicFiltersQuery(slug))
    return { success: true, message: null, data: filters }
  }

  @Post('contact')
  @Throttle(CONTACT_LIMIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Enviar una consulta',
    description:
      'Anti-spam: honeypot (`website` vacío) y 5 consultas por hora por IP y por email. Con el honeypot lleno responde 201 igual y no guarda nada.',
  })
  @ApiResponse({ status: 201, type: PublicContactResultDto })
  @ApiResponse({
    status: 409,
    description: 'PROPERTY_NOT_AVAILABLE: la propiedad ya no está disponible',
    type: ApiErrorDto,
  })
  async contact(
    @Param('slug') slug: string,
    @Body() dto: PublicContactDto,
  ): Promise<ApiSuccessDto<{ id: string }>> {
    const result = await this.commandBus.execute<
      SubmitPublicInquiryCommand,
      { id: string }
    >(
      new SubmitPublicInquiryCommand(
        slug,
        {
          name: dto.name,
          email: dto.email,
          phone: dto.phone ?? '',
          message: dto.message,
          propertyId: dto.propertyId ?? null,
          website: dto.website ?? '',
        },
        RequestContext.get()?.ip ?? null,
      ),
    )
    return { success: true, message: 'Consulta enviada', data: result }
  }
}
