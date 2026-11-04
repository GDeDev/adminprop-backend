import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import {
  AnyRole,
  CurrentUser,
  IsPublic,
  Role,
  Roles,
} from '@/modules/auth/public'
import {
  DeleteTenantLogoCommand,
  UpdateTenantSettingsCommand,
  UploadTenantLogoCommand,
} from '@/modules/tenants/application/commands/tenant-settings.commands'
import { GetCurrentTenantQuery } from '@/modules/tenants/application/queries/get-current-tenant/get-current-tenant.query'
import { GetTenantBrandingQuery } from '@/modules/tenants/application/queries/get-tenant-branding/get-tenant-branding.query'
import { GetTenantSettingsQuery } from '@/modules/tenants/application/queries/get-tenant-settings/get-tenant-settings.query'
import { TenantBrandingView } from '@/modules/tenants/application/tenant-branding.view'
import { MAX_LOGO_BYTES } from '@/modules/tenants/application/tenant-logo'
import { TenantSettingsView } from '@/modules/tenants/application/tenant-settings.view'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { TenantBrandingDto } from '../dtos/tenant-branding.dto'
import {
  LOGO_BODY,
  TenantSettingsDto,
  UpdateTenantSettingsDto,
} from '../dtos/tenant-settings.dto'
import { uploadLimits } from '@/shared/infra/uploads/upload-limits'

@ApiTags('Tenants')
@Controller({ path: 'tenants' })
export class TenantsController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @AnyRole()
  @ApiBearerAuth()
  @Get('current')
  @ApiOperation({
    summary: 'Inmobiliaria del usuario logueado',
    description:
      'Nombre, marca y datos de contacto, para el layout del backoffice y de los portales.',
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

  @ApiBearerAuth()
  @Get('current/settings')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Configuración de la inmobiliaria (admin)',
    description:
      'Datos legales, bancarios y de marca, y el último número de recibo emitido.',
  })
  @ApiResponse({ status: 200, type: TenantSettingsDto })
  @ApiResponse({ status: 403, description: 'No es admin', type: ApiErrorDto })
  async settings(
    @CurrentUser('tenantId') tenantId: string,
  ): Promise<ApiSuccessDto<TenantSettingsView>> {
    const settings = await this.queryBus.execute<
      GetTenantSettingsQuery,
      TenantSettingsView
    >(new GetTenantSettingsQuery(tenantId))
    return { success: true, message: null, data: settings }
  }

  @ApiBearerAuth()
  @Patch('current/settings')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Editar la configuración de la inmobiliaria (admin)',
    description:
      'Todos los campos son opcionales: lo que no viene no se toca; null o vacío borra el dato.',
  })
  @ApiResponse({ status: 200, type: TenantSettingsDto })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos',
    type: ApiErrorDto,
  })
  @ApiResponse({ status: 403, description: 'No es admin', type: ApiErrorDto })
  async updateSettings(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: UpdateTenantSettingsDto,
  ): Promise<ApiSuccessDto<TenantSettingsView>> {
    const settings = await this.commandBus.execute<
      UpdateTenantSettingsCommand,
      TenantSettingsView
    >(new UpdateTenantSettingsCommand(tenantId, { ...dto }))
    return {
      success: true,
      message: 'Configuración actualizada',
      data: settings,
    }
  }

  @ApiBearerAuth()
  @Post('current/logo')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', { limits: uploadLimits(MAX_LOGO_BYTES) }),
  )
  @ApiOperation({
    summary: 'Subir el logo (admin)',
    description:
      'Reemplaza al anterior. Los PDFs nuevos lo usan en el encabezado.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(LOGO_BODY)
  @ApiResponse({ status: 201, type: TenantSettingsDto })
  @ApiResponse({
    status: 400,
    description: 'No es PNG, JPG, WebP o SVG, o pesa más de 2 MB',
    type: ApiErrorDto,
  })
  @ApiResponse({ status: 403, description: 'No es admin', type: ApiErrorDto })
  async uploadLogo(
    @CurrentUser('tenantId') tenantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ApiSuccessDto<TenantSettingsView>> {
    // Sin archivo el handler responde con su propio 400.
    const settings = await this.commandBus.execute<
      UploadTenantLogoCommand,
      TenantSettingsView
    >(new UploadTenantLogoCommand(tenantId, file?.buffer ?? Buffer.alloc(0)))
    return { success: true, message: 'Logo actualizado', data: settings }
  }

  @ApiBearerAuth()
  @Delete('current/logo')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Quitar el logo (admin)' })
  @ApiResponse({ status: 200, type: TenantSettingsDto })
  @ApiResponse({ status: 403, description: 'No es admin', type: ApiErrorDto })
  async deleteLogo(
    @CurrentUser('tenantId') tenantId: string,
  ): Promise<ApiSuccessDto<TenantSettingsView>> {
    const settings = await this.commandBus.execute<
      DeleteTenantLogoCommand,
      TenantSettingsView
    >(new DeleteTenantLogoCommand(tenantId))
    return { success: true, message: 'Logo quitado', data: settings }
  }

  @IsPublic()
  @Get('by-slug/:slug')
  @ApiOperation({
    summary: 'Marca de una inmobiliaria por su slug (sin sesión)',
    description:
      'La usa el portal para mostrar el login con el logo, el color y el contacto de la inmobiliaria.',
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
