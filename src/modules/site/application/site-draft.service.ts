import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { PropertiesFacade } from '@/modules/properties/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { Configuration } from '@/shared/config/configuration'
import { RequestContext } from '@/shared/context/request-context'
import { AppException, ErrorCode } from '@/shared/errors'
import { validateSiteDraft } from '../domain/site-content.policy'
import {
  SiteTenantData,
  defaultDraft,
  templateInfo,
} from '../domain/site-templates'
import {
  SiteAssetRepository,
  SiteSettingsRecord,
  SiteSettingsRepository,
} from '../domain/site.ports'
import { SiteSettingsDraft, SiteTemplateKey } from '../domain/site.types'

const IMAGE_FIELDS: ((content: Record<string, unknown>) => unknown[])[] = [
  (c) => [obj(c.brand).logoUrl, obj(c.brand).faviconUrl],
  (c) => [obj(c.hero).backgroundImageUrl],
  (c) => arr(c.services).map((s) => obj(s).imageUrl),
  (c) => arr(c.testimonials).map((s) => obj(s).photoUrl),
  (c) => [obj(c.about).imageUrl, obj(c.seo).ogImageUrl],
]
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * Armado y validación del borrador: lo comparten guardar, resetear y publicar.
 * Todo corre dentro del tenant del contexto.
 */
@Injectable()
export class SiteDraftService {
  constructor(
    private readonly settings: SiteSettingsRepository,
    private readonly assets: SiteAssetRepository,
    private readonly tenants: TenantsFacade,
    private readonly properties: PropertiesFacade,
    private readonly config: ConfigService<Configuration, true>,
  ) {}

  private get tenantId(): string {
    const id = RequestContext.tenantId
    if (!id) throw new Error('Operación del sitio sin tenant')
    return id
  }

  /** Datos de la inmobiliaria con los que se arma el sitio inicial. */
  async tenantData(): Promise<SiteTenantData & { slug: string }> {
    const b = await this.tenants.branding(this.tenantId)
    return {
      slug: b.slug,
      name: b.name,
      logoUrl: b.logoUrl,
      primaryColor: b.primaryColor,
      phone: b.phone,
      whatsapp: b.whatsapp,
      address: b.address,
      email: b.email,
    }
  }

  /** La configuración del tenant; si no existe todavía, la crea con los defaults. */
  async ensure(): Promise<SiteSettingsRecord> {
    const current = await this.settings.findCurrent()
    if (current) return current
    const draft = defaultDraft('CLASSIC', await this.tenantData())
    try {
      return await this.settings.create({ templateKey: 'CLASSIC', draft })
    } catch (error) {
      // Dos pestañas pidiendo el sitio por primera vez a la vez: la segunda
      // choca con el índice único de `tenant_id`. Ya existe, se lee.
      const existing = await this.settings.findCurrent()
      if (existing) return existing
      throw error
    }
  }

  /**
   * Valida el borrador completo y lo devuelve normalizado. Errores por campo
   * como 422. Con `forPublish` además exige sitio completo y contraste AA.
   */
  async validate(
    input: unknown,
    options: { forPublish?: boolean } = {},
  ): Promise<SiteSettingsDraft> {
    const template = (input as { template?: SiteTemplateKey } | null)?.template
    const info = templateInfo(template === 'MODERN' ? 'MODERN' : 'CLASSIC')
    const isAllowedImageUrl = await this.imageGuard(input)

    const result = validateSiteDraft(
      input,
      {
        fontKeys: info.fontOptions.map((f) => f.key),
        supportedSections: info.supportedSections,
        isAllowedImageUrl,
      },
      options,
    )
    if (!result.ok) {
      throw AppException.unprocessable(
        options.forPublish
          ? 'El sitio no está listo para publicarse. Revisá los campos marcados.'
          : 'Hay campos con errores. Revisá los marcados.',
        ErrorCode.UNPROCESSABLE_ENTITY,
        { details: result.errors },
      )
    }
    return result.value
  }

  /**
   * Propiedades elegidas a mano que ya no existen (o son de otra
   * inmobiliaria): el id de otro tenant "no existe" para esta consulta.
   */
  async missingProperties(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return []
    const found = await this.properties.describe(ids)
    return ids.filter((id) => !found.has(id))
  }

  /**
   * Una imagen es válida si la subió esta inmobiliaria al editor, es su logo,
   * o es https de un host permitido por configuración.
   */
  private async imageGuard(input: unknown): Promise<(url: string) => boolean> {
    const content = obj(obj(input).content)
    const urls = [
      ...new Set(
        IMAGE_FIELDS.flatMap((pick) => pick(content)).filter(
          (u): u is string => typeof u === 'string' && u.length > 0,
        ),
      ),
    ]
    if (urls.length === 0) return () => false

    const [owned, branding] = await Promise.all([
      this.assets.existingUrls(urls),
      this.tenants.branding(this.tenantId),
    ])
    const hosts = this.config.get('sites', { infer: true }).allowedImageHosts
    return (url) => {
      if (owned.has(url) || (branding.logoUrl && url === branding.logoUrl)) {
        return true
      }
      try {
        const parsed = new URL(url)
        return (
          parsed.protocol === 'https:' &&
          hosts.some(
            (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`),
          )
        )
      } catch {
        return false
      }
    }
  }
}
