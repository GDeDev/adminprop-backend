import { Injectable } from '@nestjs/common'

import { sameDraft } from '../domain/site-content.policy'
import { SiteSettingsRecord } from '../domain/site.ports'
import { SiteSettingsDraft } from '../domain/site.types'
import { SiteDraftService } from './site-draft.service'
import { SiteUrls } from './site-urls'

/** `SiteSettings` del contrato (5.1). */
export interface SiteSettingsView {
  enabled: boolean
  subdomain: string | null
  customDomain: string | null
  draft: SiteSettingsDraft
  publishedAt: string | null
  hasUnpublishedChanges: boolean
  publicUrl: string | null
}

@Injectable()
export class SiteViews {
  constructor(
    private readonly urls: SiteUrls,
    private readonly drafts: SiteDraftService,
  ) {}

  async settings(record: SiteSettingsRecord): Promise<SiteSettingsView> {
    const { slug } = await this.drafts.tenantData()
    return {
      enabled: record.enabled,
      subdomain: record.subdomain,
      customDomain: record.customDomain,
      draft: record.draft,
      publishedAt: record.publishedAt?.toISOString() ?? null,
      // Nunca publicado: hay todo por publicar.
      hasUnpublishedChanges:
        !record.published || !sameDraft(record.draft, record.published),
      publicUrl: this.urls.publicUrl({
        slug,
        subdomain: record.subdomain,
        customDomain: record.customDomain,
      }),
    }
  }
}
