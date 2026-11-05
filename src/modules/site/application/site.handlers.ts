import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { randomUUID } from 'node:crypto'

import { AuditFacade } from '@/modules/audit/public'
import { StoragePort } from '@/platform/storage/storage.port'
import { RequestContext } from '@/shared/context/request-context'
import { AppException, ErrorCode, ErrorDetail } from '@/shared/errors'
import { errorMessage } from '@/shared/core/error-message'
import { createLogger } from '@/shared/logging/root-logger'
import { mergeDraft } from '../domain/site-content.policy'
import { SiteHostPolicy } from '../domain/site-host.policy'
import {
  defaultContent,
  defaultTheme,
  templateInfo,
} from '../domain/site-templates'
import { MAX_IMAGE_SIDE, readImageInfo } from '../domain/image-info'
import {
  DomainNotVerifiedException,
  DomainTakenException,
  InvalidSiteImageException,
  NoCustomDomainException,
  SiteAssetLimitException,
  SubdomainTakenException,
} from '../domain/site.exceptions'
import {
  DnsTxtPort,
  SiteAssetRepository,
  SiteSettingsChanges,
  SiteSettingsRepository,
} from '../domain/site.ports'
import {
  SITE_TEMPLATE_KEYS,
  SiteSettingsDraft,
  SiteTemplateKey,
} from '../domain/site.types'
import { SiteDraftService } from './site-draft.service'
import { SiteHostResolver } from './site-host-resolver'
import { SiteUrls } from './site-urls'
import { SiteChangeNotifier } from './site-change-notifier'
import { SiteDomainVerification } from './site-domain-verification'
import {
  PublishSiteCommand,
  ResetSiteTemplateCommand,
  UnpublishSiteCommand,
  UpdateSiteSettingsCommand,
  UploadSiteAssetCommand,
  VerifySiteDomainCommand,
} from './site.commands'
import { SiteSettingsView, SiteViews } from './site.views'

export const MAX_SITE_ASSET_BYTES = 5 * 1024 * 1024
/** Tope por inmobiliaria: frena el abuso del storage. */
export const MAX_SITE_ASSETS = 200

function isUniqueViolation(error: unknown): string | null {
  const e = error as { code?: string; meta?: { target?: unknown } }
  return e?.code === 'P2002' ? String(e.meta?.target ?? '') : null
}

/**
 * Guarda el borrador. `template`, `theme` y `content` son parciales (ver
 * `mergeDraft`); `subdomain` y `customDomain` valen en el momento: no
 * pasan por borrador porque son de infraestructura, no de contenido.
 */
@CommandHandler(UpdateSiteSettingsCommand)
export class UpdateSiteSettingsHandler implements ICommandHandler<
  UpdateSiteSettingsCommand,
  SiteSettingsView
> {
  constructor(
    private readonly settings: SiteSettingsRepository,
    private readonly drafts: SiteDraftService,
    private readonly urls: SiteUrls,
    private readonly resolver: SiteHostResolver,
    private readonly views: SiteViews,
    private readonly verification: SiteDomainVerification,
    private readonly audit: AuditFacade,
    private readonly notifier: SiteChangeNotifier,
  ) {}

  async execute({
    patch,
  }: UpdateSiteSettingsCommand): Promise<SiteSettingsView> {
    const current = await this.drafts.ensure()
    const changes: SiteSettingsChanges = {}

    // ---- Dominios (se validan primero: son los errores más baratos)
    const hostErrors: ErrorDetail[] = []
    if (
      patch.subdomain !== undefined &&
      patch.subdomain !== current.subdomain
    ) {
      if (patch.subdomain === null || patch.subdomain === '') {
        changes.subdomain = null
      } else {
        const check = SiteHostPolicy.checkSubdomain(patch.subdomain)
        if (!check.ok)
          hostErrors.push({ field: 'subdomain', message: check.reason })
        else if (check.value !== current.subdomain)
          changes.subdomain = check.value
      }
    }
    if (
      patch.customDomain !== undefined &&
      patch.customDomain !== current.customDomain
    ) {
      if (patch.customDomain === null || patch.customDomain === '') {
        changes.customDomain = null
        changes.customDomainVerifiedAt = null
      } else {
        const check = SiteHostPolicy.checkCustomDomain(
          patch.customDomain,
          this.urls.baseDomain,
        )
        if (!check.ok)
          hostErrors.push({ field: 'customDomain', message: check.reason })
        else if (check.value !== current.customDomain) {
          changes.customDomain = check.value
          // Un dominio nuevo arranca sin verificar (salvo con la verificación
          // apagada, en desarrollo): hay que demostrar que es propio.
          changes.customDomainVerifiedAt = this.verification.required
            ? null
            : new Date()
        }
      }
    }
    if (hostErrors.length > 0) {
      throw AppException.unprocessable(
        'Revisá el subdominio o el dominio.',
        ErrorCode.UNPROCESSABLE_ENTITY,
        { details: hostErrors },
      )
    }
    if (
      changes.subdomain &&
      (await this.settings.subdomainTakenByOther(changes.subdomain))
    ) {
      throw new SubdomainTakenException()
    }
    if (
      changes.customDomain &&
      (await this.settings.domainTakenByOther(changes.customDomain))
    ) {
      throw new DomainTakenException()
    }

    // ---- Borrador
    const touchesDraft =
      patch.template !== undefined ||
      patch.theme !== undefined ||
      patch.content !== undefined
    if (touchesDraft) {
      const merged = mergeDraft(current.draft, patch) as SiteSettingsDraft
      // Cada template tiene sus tipografías: al cambiar de template, si la
      // actual no existe en el nuevo, se vuelve a la del template.
      if (
        SITE_TEMPLATE_KEYS.includes(merged.template) &&
        merged.template !== current.draft.template &&
        merged.theme &&
        typeof merged.theme === 'object'
      ) {
        const info = templateInfo(merged.template)
        const fontOk = info.fontOptions.some(
          (f) => f.key === merged.theme.fontKey,
        )
        if (!fontOk)
          merged.theme = { ...merged.theme, fontKey: info.defaultTheme.fontKey }
      }
      const draft = await this.drafts.validate(merged)
      changes.draft = draft
      changes.templateKey = draft.template
    }

    if (Object.keys(changes).length === 0) return this.views.settings(current)

    try {
      const updated = await this.settings.update(current.id, changes)
      if (touchesDraft) await this.recordBlocks(current.id, patch)
      if (
        changes.subdomain !== undefined ||
        changes.customDomain !== undefined
      ) {
        // La dirección cambia al instante (no pasa por el borrador): se olvida lo
        // cacheado de esta instancia y, si el sitio está publicado, se avisa a
        // `apps/sites` para que su caché de hosts deje de resolver la anterior.
        this.resolver.invalidate()
        if (current.enabled) await this.notifier.notify()
      }
      return this.views.settings(updated)
    } catch (error) {
      // Carrera entre dos altas del mismo subdominio: lo frena el índice único.
      const target = isUniqueViolation(error)
      if (target?.includes('subdomain')) throw new SubdomainTakenException()
      if (target?.includes('custom_domain')) throw new DomainTakenException()
      throw error
    }
  }

  /**
   * El contenido no entra al historial automático (es un JSON enorme), así que
   * se deja un evento con QUÉ se tocó, sin los textos: bloques de contenido y
   * campos del tema.
   */
  private recordBlocks(
    entityId: string,
    patch: UpdateSiteSettingsCommand['patch'],
  ): Promise<void> {
    const keys = (value: unknown): string[] =>
      typeof value === 'object' && value !== null ? Object.keys(value) : []
    return this.audit.record({
      action: 'UPDATE',
      entity: 'SiteSettings',
      entityId,
      summary: 'Sitio web: borrador guardado',
      changes: {
        template:
          patch.template === undefined ? undefined : { after: patch.template },
        themeFields: { after: keys(patch.theme) },
        contentBlocks: { after: keys(patch.content) },
      },
    })
  }
}

/** Vuelve el tema (y, si no se conserva, el contenido) al del template elegido. */
@CommandHandler(ResetSiteTemplateCommand)
export class ResetSiteTemplateHandler implements ICommandHandler<
  ResetSiteTemplateCommand,
  SiteSettingsView
> {
  constructor(
    private readonly settings: SiteSettingsRepository,
    private readonly drafts: SiteDraftService,
    private readonly views: SiteViews,
  ) {}

  async execute({
    keepContent,
  }: ResetSiteTemplateCommand): Promise<SiteSettingsView> {
    const current = await this.drafts.ensure()
    const template: SiteTemplateKey = current.draft.template
    const draft = await this.drafts.validate({
      template,
      theme: defaultTheme(template),
      content: keepContent
        ? current.draft.content
        : defaultContent(await this.drafts.tenantData()),
    })
    const updated = await this.settings.update(current.id, {
      draft,
      templateKey: template,
    })
    return this.views.settings(updated)
  }
}

/** Valida el borrador completo, lo copia a `published` y prende el sitio. */
@CommandHandler(PublishSiteCommand)
export class PublishSiteHandler implements ICommandHandler<
  PublishSiteCommand,
  SiteSettingsView
> {
  constructor(
    private readonly settings: SiteSettingsRepository,
    private readonly drafts: SiteDraftService,
    private readonly resolver: SiteHostResolver,
    private readonly views: SiteViews,
    private readonly notifier: SiteChangeNotifier,
  ) {}

  async execute(): Promise<SiteSettingsView> {
    const current = await this.drafts.ensure()
    const draft = await this.drafts.validate(current.draft, {
      forPublish: true,
    })

    const missing = await this.drafts.missingProperties(
      draft.content.featured.propertyIds,
    )
    if (missing.length > 0) {
      throw AppException.unprocessable(
        'Alguna de las propiedades destacadas ya no existe.',
        ErrorCode.UNPROCESSABLE_ENTITY,
        {
          details: missing.map((id) => ({
            field: 'content.featured.propertyIds',
            message: `La propiedad ${id} ya no existe: sacala de las destacadas.`,
          })),
        },
      )
    }

    const updated = await this.settings.update(current.id, {
      draft,
      published: draft,
      templateKey: draft.template,
      enabled: true,
      publishedAt: new Date(),
      publishedById: RequestContext.get()?.userId ?? null,
    })
    this.resolver.invalidate()
    await this.notifier.notify()
    return this.views.settings(updated)
  }
}

/** Apaga el sitio (pasa a 404) sin perder nada de lo configurado. */
@CommandHandler(UnpublishSiteCommand)
export class UnpublishSiteHandler implements ICommandHandler<
  UnpublishSiteCommand,
  SiteSettingsView
> {
  constructor(
    private readonly settings: SiteSettingsRepository,
    private readonly drafts: SiteDraftService,
    private readonly resolver: SiteHostResolver,
    private readonly views: SiteViews,
    private readonly notifier: SiteChangeNotifier,
  ) {}

  async execute(): Promise<SiteSettingsView> {
    const current = await this.drafts.ensure()
    if (!current.enabled) return this.views.settings(current)
    const updated = await this.settings.update(current.id, { enabled: false })
    this.resolver.invalidate()
    await this.notifier.notify()
    return this.views.settings(updated)
  }
}

/**
 * Comprueba el registro TXT del dominio propio y, si está, lo activa. Un dominio
 * verificado es único en todo el sistema: si otra inmobiliaria lo verificó
 * primero, es un 409.
 */
@CommandHandler(VerifySiteDomainCommand)
export class VerifySiteDomainHandler implements ICommandHandler<
  VerifySiteDomainCommand,
  SiteSettingsView
> {
  constructor(
    private readonly settings: SiteSettingsRepository,
    private readonly drafts: SiteDraftService,
    private readonly verification: SiteDomainVerification,
    private readonly dns: DnsTxtPort,
    private readonly resolver: SiteHostResolver,
    private readonly views: SiteViews,
    private readonly notifier: SiteChangeNotifier,
  ) {}

  async execute(): Promise<SiteSettingsView> {
    const current = await this.drafts.ensure()
    const domain = current.customDomain
    if (!domain) throw new NoCustomDomainException()
    if (current.customDomainVerifiedAt) return this.views.settings(current)

    const expected = this.verification.record(current.tenantId, domain)
    const found = await this.dns.resolveTxt(expected.host)
    if (!found.some((value) => value.trim() === expected.value)) {
      throw new DomainNotVerifiedException(expected.host)
    }
    if (await this.settings.domainTakenByOther(domain)) {
      throw new DomainTakenException()
    }

    try {
      const updated = await this.settings.update(current.id, {
        customDomainVerifiedAt: new Date(),
      })
      this.resolver.invalidate()
      await this.notifier.notify()
      return this.views.settings(updated)
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainTakenException()
      throw error
    }
  }
}

/** Sube una imagen del sitio: JPG, PNG o WebP de hasta 5 MB, validada por contenido. */
@CommandHandler(UploadSiteAssetCommand)
export class UploadSiteAssetHandler implements ICommandHandler<
  UploadSiteAssetCommand,
  { id: string; url: string; width: number | null; height: number | null }
> {
  private readonly logger = createLogger('UploadSiteAssetHandler')

  constructor(
    private readonly assets: SiteAssetRepository,
    private readonly storage: StoragePort,
  ) {}

  async execute({ file }: UploadSiteAssetCommand) {
    if (file.length === 0)
      throw new InvalidSiteImageException('falta el archivo.')
    if (file.length > MAX_SITE_ASSET_BYTES) {
      throw new InvalidSiteImageException('pesa más de 5 MB.')
    }
    const info = readImageInfo(file)
    if (!info) {
      throw new InvalidSiteImageException(
        'tiene que ser JPG, PNG o WebP (no se admite SVG).',
      )
    }
    if (
      (info.width ?? 0) > MAX_IMAGE_SIDE ||
      (info.height ?? 0) > MAX_IMAGE_SIDE
    ) {
      throw new InvalidSiteImageException(
        `mide más de ${MAX_IMAGE_SIDE} px de lado.`,
      )
    }
    if ((await this.assets.count()) >= MAX_SITE_ASSETS) {
      throw new SiteAssetLimitException(MAX_SITE_ASSETS)
    }

    const stored = await this.storage.upload(
      file,
      `site/asset-${randomUUID()}.${info.extension}`,
      { contentType: info.contentType },
    )
    try {
      const asset = await this.assets.create({
        storageKey: stored.key,
        url: stored.url,
        contentType: info.contentType,
        sizeBytes: file.length,
        width: info.width,
        height: info.height,
      })
      return {
        id: asset.id,
        url: asset.url,
        width: info.width,
        height: info.height,
      }
    } catch (error) {
      // Sin fila el archivo queda huérfano: se borra.
      await this.storage
        .delete(stored.key)
        .catch((e: unknown) =>
          this.logger.warn(
            { err: errorMessage(e) },
            'No se pudo borrar el archivo huérfano',
          ),
        )
      throw error
    }
  }
}
