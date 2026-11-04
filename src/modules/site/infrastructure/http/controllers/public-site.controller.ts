import { Controller, Get, Param, Query, Res } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'

import { IsPublic } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { SkipThrottleForTrustedServer } from '@/shared/infra/throttler/trusted-server'
import { PublicSiteView } from '../../../application/site.query-handlers'
import {
  GetPublicSiteQuery,
  ResolveSiteHostQuery,
} from '../../../application/site.queries'
import { PublicSiteDto, SiteHostDto } from '../dtos/site.dtos'

/** El sitio lo pide el servidor de `apps/sites` (una sola IP): topes más altos que los del portal. */
const SITE_READ_LIMIT = { medium: { limit: 300, ttl: 60_000 } }
const HOST_LOOKUP_LIMIT = { medium: { limit: 600, ttl: 60_000 } }

/** Lecturas públicas del sitio web: sin sesión, solo lo publicado. */
@ApiTags('Public site')
@IsPublic()
@Controller({ path: 'public' })
export class PublicSiteController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('site-by-host')
  @Throttle(HOST_LOOKUP_LIMIT)
  @SkipThrottleForTrustedServer()
  @ApiOperation({
    summary: 'Resuelve el slug a partir del host',
    description:
      '`<subdominio>.<SITES_BASE_DOMAIN>` o un dominio propio. Lo usa el middleware de apps/sites.',
  })
  @ApiQuery({ name: 'host', example: 'mi-inmobiliaria.adminprop.com' })
  @ApiResponse({ status: 200, type: SiteHostDto })
  @ApiResponse({
    status: 404,
    description: 'SITE_NOT_FOUND',
    type: ApiErrorDto,
  })
  async byHost(
    @Query('host') host = '',
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessDto<{ slug: string }>> {
    const data = await this.queryBus.execute<
      ResolveSiteHostQuery,
      { slug: string }
    >(new ResolveSiteHostQuery(String(host)))
    res.set('Cache-Control', 'public, max-age=0, s-maxage=60')
    return { success: true, message: null, data }
  }

  @Get(':slug/site')
  @Throttle(SITE_READ_LIMIT)
  @SkipThrottleForTrustedServer()
  @ApiOperation({
    summary: 'El sitio publicado de una inmobiliaria',
    description:
      'Con `?preview=<token>` (de GET /site/preview-token) devuelve el borrador, sin caché.',
  })
  @ApiParam({ name: 'slug', example: 'oppido' })
  @ApiQuery({ name: 'preview', required: false })
  @ApiResponse({ status: 200, type: PublicSiteDto })
  @ApiResponse({
    status: 404,
    description:
      'SITE_NOT_FOUND: no existe, no está publicado o el token no corresponde',
    type: ApiErrorDto,
  })
  async site(
    @Param('slug') slug: string,
    @Query('preview') preview: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessDto<PublicSiteView>> {
    const { site, preview: isPreview } = await this.queryBus.execute<
      GetPublicSiteQuery,
      { site: PublicSiteView; preview: boolean }
    >(new GetPublicSiteQuery(slug, preview ? String(preview) : null))
    if (isPreview) {
      // El borrador no se cachea ni se indexa.
      res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' })
    } else {
      res.set('Cache-Control', 'public, max-age=0, s-maxage=60')
    }
    return { success: true, message: null, data: site }
  }
}
