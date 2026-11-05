import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Configuration } from '@/shared/config/configuration'

/** Calcula la URL pública de un sitio y a qué dominio base pertenece. */
@Injectable()
export class SiteUrls {
  constructor(private readonly config: ConfigService<Configuration, true>) {}

  get baseDomain(): string | null {
    return this.config.get('sites', { infer: true }).baseDomain
  }

  /** Dominio propio > subdominio > acceso por slug (solo desarrollo) > null. */
  publicUrl(site: {
    slug: string
    subdomain: string | null
    /** Solo un dominio verificado cuenta: uno pendiente todavía no resuelve. */
    customDomain: string | null
    customDomainVerified: boolean
  }): string | null {
    const sites = this.config.get('sites', { infer: true })
    if (site.customDomain && site.customDomainVerified) {
      return `https://${site.customDomain}`
    }
    if (site.subdomain && sites.baseDomain) {
      return `${sites.protocol}://${site.subdomain}.${sites.baseDomain}`
    }
    return sites.devUrl ? `${sites.devUrl}/_s/${site.slug}` : null
  }
}
