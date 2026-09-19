import { Controller, Get, Param } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { TenantBrandingView } from '@/modules/tenants/application/tenant-branding.view'
import { GetCurrentTenantQuery } from '@/modules/tenants/application/queries/get-current-tenant/get-current-tenant.query'
import { GetTenantBrandingQuery } from '@/modules/tenants/application/queries/get-tenant-branding/get-tenant-branding.query'
import { CurrentUser, IsPublic } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { TenantBrandingDto } from '../dtos/tenant-branding.dto'

@ApiTags('Tenants')
@Controller({ path: 'tenants' })
export class TenantsController {
  constructor(private readonly queryBus: QueryBus) {}

  @ApiBearerAuth()
  @Get('current')
  @ApiOperation({
    summary: 'Inmobiliaria del usuario logueado',
    description: 'Nombre y marca, para el layout del backoffice y del portal.',
  })
  @ApiResponse({ status: 200, type: TenantBrandingDto })
  async current(
    @CurrentUser('tenantId') tenantId: string,
  ): Promise<ApiSuccessDto<TenantBrandingView>> {
    const tenant = await this.queryBus.execute<
      GetCurrentTenantQuery,
      TenantBrandingView
    >(new GetCurrentTenantQuery(tenantId))

    return { success: true, message: null, data: tenant }
  }

  @IsPublic()
  @Get('by-slug/:slug')
  @ApiOperation({
    summary: 'Marca de una inmobiliaria por su slug (sin sesión)',
    description:
      'La usa el portal para mostrar el login con el logo y el color de la inmobiliaria.',
  })
  @ApiParam({ name: 'slug', example: 'demo' })
  @ApiResponse({ status: 200, type: TenantBrandingDto })
  @ApiResponse({
    status: 404,
    description: 'No existe o está deshabilitada',
    type: ApiErrorDto,
  })
  async bySlug(
    @Param('slug') slug: string,
  ): Promise<ApiSuccessDto<TenantBrandingView>> {
    const tenant = await this.queryBus.execute<
      GetTenantBrandingQuery,
      TenantBrandingView
    >(new GetTenantBrandingQuery(slug))

    return { success: true, message: null, data: tenant }
  }
}
