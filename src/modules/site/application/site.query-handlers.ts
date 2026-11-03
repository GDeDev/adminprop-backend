import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { SiteHostPolicy } from '../domain/site-host.policy'
import { allTemplates } from '../domain/site-templates'
import { SiteNotFoundException } from '../domain/site.exceptions'
import { SiteSettingsRepository } from '../domain/site.ports'
import { SiteSettingsDraft, SiteTemplateInfo } from '../domain/site.types'
import { SiteDraftService } from './site-draft.service'
import { SiteHostResolver } from './site-host-resolver'
import { SitePreviewTokenService } from './site-preview-token.service'
import {
  CheckSubdomainQuery,
  GetPublicSiteQuery,
  GetSitePreviewTokenQuery,
  GetSiteSettingsQuery,
  ListSiteTemplatesQuery,
  ResolveSiteHostQuery,
} from './site.queries'
import { SiteSettingsView, SiteViews } from './site.views'

/** `PublicSite` del contrato (5.1): lista blanca de lo que lee el sitio. */
export interface PublicSiteView extends SiteSettingsDraft {
  tenant: { slug: string; name: string; logoUrl: string | null }
  publishedAt: string
}

@QueryHandler(ListSiteTemplatesQuery)
export class ListSiteTemplatesHandler implements IQueryHandler<
  ListSiteTemplatesQuery,
  SiteTemplateInfo[]
> {
  execute(): Promise<SiteTemplateInfo[]> {
    return Promise.resolve(allTemplates())
  }
}

/** La primera vez crea la configuración con los datos de la inmobiliaria. */
@QueryHandler(GetSiteSettingsQuery)
export class GetSiteSettingsHandler implements IQueryHandler<
  GetSiteSettingsQuery,
  SiteSettingsView
> {
  constructor(
    private readonly drafts: SiteDraftService,
    private readonly views: SiteViews,
  ) {}

  async execute(): Promise<SiteSettingsView> {
    return this.views.settings(await this.drafts.ensure())
  }
}

@QueryHandler(GetSitePreviewTokenQuery)
export class GetSitePreviewTokenHandler implements IQueryHandler<
  GetSitePreviewTokenQuery,
  { token: string; expiresAt: string }
> {
  constructor(private readonly tokens: SitePreviewTokenService) {}

  async execute() {
    const context = RequestContext.get()
    if (!context?.tenantId) throw new Error('Vista previa sin tenant')
    const { token, expiresAt } = await this.tokens.sign(
      context.tenantId,
      context.userId ?? null,
    )
    return { token, expiresAt: expiresAt.toISOString() }
  }
}

@QueryHandler(CheckSubdomainQuery)
export class CheckSubdomainHandler implements IQueryHandler<
  CheckSubdomainQuery,
  { value: string; available: boolean; reason: string | null }
> {
  constructor(private readonly settings: SiteSettingsRepository) {}

  async execute({ value }: CheckSubdomainQuery) {
    const check = SiteHostPolicy.checkSubdomain(value)
    if (!check.ok) {
      return {
        value: SiteHostPolicy.normalizeSubdomain(value),
        available: false,
        reason: check.reason,
      }
    }
    const taken = await this.settings.subdomainTakenByOther(check.value)
    return {
      value: check.value,
      available: !taken,
      reason: taken ? 'Ese subdominio ya está en uso.' : null,
    }
  }
}

/**
 * El sitio público de una inmobiliaria. Deshabilitado, sin publicar, de una
 * inmobiliaria inexistente o con un token de vista previa ajeno: el mismo 404.
 */
@QueryHandler(GetPublicSiteQuery)
export class GetPublicSiteHandler implements IQueryHandler<
  GetPublicSiteQuery,
  { site: PublicSiteView; preview: boolean }
> {
  constructor(
    private readonly tenants: TenantsFacade,
    private readonly settings: SiteSettingsRepository,
    private readonly tokens: SitePreviewTokenService,
  ) {}

  async execute({ slug, previewToken }: GetPublicSiteQuery) {
    const tenant = await this.tenants.findActiveBySlug(slug)
    if (!tenant) throw new SiteNotFoundException()

    let preview = false
    if (previewToken) {
      if ((await this.tokens.verify(previewToken)) !== tenant.id) {
        throw new SiteNotFoundException()
      }
      preview = true
    }

    return RequestContext.runInTenant(tenant.id, async () => {
      const record = await this.settings.findCurrent()
      const source = preview
        ? record?.draft
        : record?.enabled
          ? record.published
          : null
      if (!record || !source) throw new SiteNotFoundException()

      const branding = await this.tenants.branding(tenant.id)
      return {
        preview,
        site: {
          template: source.template,
          theme: source.theme,
          content: source.content,
          tenant: {
            slug: tenant.slug,
            name: tenant.name,
            logoUrl: branding.logoUrl,
          },
          publishedAt: (preview
            ? record.updatedAt
            : (record.publishedAt ?? record.updatedAt)
          ).toISOString(),
        },
      }
    })
  }
}

@QueryHandler(ResolveSiteHostQuery)
export class ResolveSiteHostHandler implements IQueryHandler<
  ResolveSiteHostQuery,
  { slug: string }
> {
  constructor(private readonly resolver: SiteHostResolver) {}

  async execute({ host }: ResolveSiteHostQuery) {
    const slug = await this.resolver.resolve(host)
    if (!slug) throw new SiteNotFoundException()
    return { slug }
  }
}
