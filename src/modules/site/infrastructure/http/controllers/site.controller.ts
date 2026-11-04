import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { Throttle } from '@nestjs/throttler'

import { Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import {
  PublishSiteCommand,
  ResetSiteTemplateCommand,
  UnpublishSiteCommand,
  UpdateSiteSettingsCommand,
  UploadSiteAssetCommand,
  VerifySiteDomainCommand,
} from '../../../application/site.commands'
import { MAX_SITE_ASSET_BYTES } from '../../../application/site.handlers'
import {
  CheckSubdomainQuery,
  GetSiteDomainQuery,
  GetSitePreviewTokenQuery,
  GetSiteSettingsQuery,
  ListSiteTemplatesQuery,
} from '../../../application/site.queries'
import { SiteSettingsView } from '../../../application/site.views'
import { SiteTemplateInfo } from '../../../domain/site.types'
import {
  ResetSiteTemplateDto,
  SiteAssetDto,
  SiteDomainDto,
  SitePreviewTokenDto,
  SiteSettingsDto,
  SiteTemplateInfoDto,
  SubdomainAvailabilityDto,
  UpdateSiteSettingsDto,
} from '../dtos/site.dtos'

/** Mi sitio web: configuración, publicación e imágenes. Solo el administrador. */
@ApiTags('Site')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller({ path: 'site' })
@ApiResponse({
  status: 403,
  description: 'No es administrador',
  type: ApiErrorDto,
})
export class SiteController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('templates')
  @ApiOperation({ summary: 'Templates disponibles, con su tema por defecto' })
  @ApiResponse({ status: 200, type: [SiteTemplateInfoDto] })
  async templates(): Promise<ApiSuccessDto<SiteTemplateInfo[]>> {
    const data = await this.queryBus.execute<
      ListSiteTemplatesQuery,
      SiteTemplateInfo[]
    >(new ListSiteTemplatesQuery())
    return { success: true, message: null, data }
  }

  @Get('settings')
  @ApiOperation({
    summary: 'Configuración del sitio',
    description:
      'La primera vez la crea con el template CLASSIC y los datos de la inmobiliaria, deshabilitada.',
  })
  @ApiResponse({ status: 200, type: SiteSettingsDto })
  settings() {
    return this.query(new GetSiteSettingsQuery())
  }

  @Put('settings')
  @ApiOperation({
    summary: 'Guardar el borrador (parcial)',
    description:
      'Cambia el borrador, no el sitio publicado. `subdomain` y `customDomain` se aplican al instante.',
  })
  @ApiResponse({ status: 200, type: SiteSettingsDto })
  @ApiResponse({
    status: 409,
    description: 'SUBDOMAIN_TAKEN o DOMAIN_TAKEN',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Errores por campo en `errors`',
    type: ApiErrorDto,
  })
  update(@Body() dto: UpdateSiteSettingsDto) {
    return this.command(
      new UpdateSiteSettingsCommand({
        template: dto.template,
        theme: dto.theme,
        content: dto.content,
        subdomain: dto.subdomain,
        customDomain: dto.customDomain,
      }),
      'Borrador guardado',
    )
  }

  @Post('settings/reset-template')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Restaurar el tema (y opcionalmente el contenido) del template',
  })
  @ApiResponse({ status: 200, type: SiteSettingsDto })
  reset(@Body() dto: ResetSiteTemplateDto) {
    return this.command(
      new ResetSiteTemplateCommand(dto.keepContent),
      'Tema restaurado',
    )
  }

  @Post('publish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Publicar',
    description:
      'Valida el borrador completo, lo copia a lo publicado y prende el sitio.',
  })
  @ApiResponse({ status: 200, type: SiteSettingsDto })
  @ApiResponse({
    status: 422,
    description: 'El borrador está incompleto o inválido',
    type: ApiErrorDto,
  })
  publish() {
    return this.command(new PublishSiteCommand(), 'Sitio publicado')
  }

  @Post('unpublish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Despublicar',
    description: 'El sitio pasa a 404. No se pierde nada de lo configurado.',
  })
  @ApiResponse({ status: 200, type: SiteSettingsDto })
  unpublish() {
    return this.command(new UnpublishSiteCommand(), 'Sitio despublicado')
  }

  @Post('assets')
  @Throttle({ medium: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_SITE_ASSET_BYTES } }),
  )
  @ApiOperation({
    summary: 'Subir una imagen',
    description:
      'JPG, PNG o WebP de hasta 5 MB, validada por contenido. No se admite SVG.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, type: SiteAssetDto })
  @ApiResponse({
    status: 400,
    description: 'No es una imagen válida o pesa más de 5 MB',
    type: ApiErrorDto,
  })
  async upload(@UploadedFile() file: Express.Multer.File | undefined) {
    const data = await this.commandBus.execute(
      new UploadSiteAssetCommand(file?.buffer ?? Buffer.alloc(0)),
    )
    return { success: true, message: 'Imagen subida', data }
  }

  @Get('preview-token')
  @ApiOperation({
    summary: 'Token de vista previa',
    description:
      'JWT de 15 minutos que abre el borrador en el sitio con `?preview=<token>`.',
  })
  @ApiResponse({ status: 200, type: SitePreviewTokenDto })
  previewToken() {
    return this.query(new GetSitePreviewTokenQuery())
  }

  @Get('domain')
  @ApiOperation({
    summary: 'Estado del dominio propio',
    description:
      'Si está verificado y, si no, el registro TXT que hay que cargar en el DNS para demostrar que es tuyo.',
  })
  @ApiResponse({ status: 200, type: SiteDomainDto })
  domain() {
    return this.query(new GetSiteDomainQuery())
  }

  @Post('domain/verify')
  @HttpCode(200)
  @Throttle({ medium: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verificar el dominio propio',
    description:
      'Busca el registro TXT en el DNS. Hasta que se verifica, el dominio está reservado pero no resuelve el sitio.',
  })
  @ApiResponse({ status: 200, type: SiteSettingsDto })
  @ApiResponse({
    status: 409,
    description: 'DOMAIN_TAKEN: otra inmobiliaria lo verificó primero',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'DOMAIN_NOT_VERIFIED o NO_CUSTOM_DOMAIN',
    type: ApiErrorDto,
  })
  verifyDomain() {
    return this.command(new VerifySiteDomainCommand(), 'Dominio verificado')
  }

  @Get('subdomain-availability')
  @ApiOperation({ summary: 'Verifica si un subdominio es válido y está libre' })
  @ApiQuery({ name: 'value', example: 'mi-inmobiliaria' })
  @ApiResponse({ status: 200, type: SubdomainAvailabilityDto })
  subdomainAvailability(@Query('value') value = '') {
    return this.query(new CheckSubdomainQuery(String(value).slice(0, 80)))
  }

  private async query(query: object): Promise<ApiSuccessDto<SiteSettingsView>> {
    const data = await this.queryBus.execute(query)
    return { success: true, message: null, data }
  }

  private async command(
    command: object,
    message: string,
  ): Promise<ApiSuccessDto<SiteSettingsView>> {
    const data = await this.commandBus.execute(command)
    return { success: true, message, data }
  }
}
