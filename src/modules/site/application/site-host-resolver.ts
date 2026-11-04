import { Injectable } from '@nestjs/common'

import { TenantsFacade } from '@/modules/tenants/public'
import { SiteHostPolicy } from '../domain/site-host.policy'
import { SiteSettingsRepository } from '../domain/site.ports'
import { SiteUrls } from './site-urls'

const HIT_TTL_MS = 30_000
const MISS_TTL_MS = 10_000
const MAX_ENTRIES = 5_000

/**
 * Host → slug, sin sesión. Cachea en memoria con TTL corto (también los
 * "no existe", más corto) para que un sitio con tráfico no consulte la base
 * en cada pedido. Con varias instancias cada una tiene su caché: un cambio de
 * dominio tarda como mucho el TTL en verse.
 */
@Injectable()
export class SiteHostResolver {
  private readonly cache = new Map<
    string,
    { slug: string | null; expires: number }
  >()

  constructor(
    private readonly settings: SiteSettingsRepository,
    private readonly tenants: TenantsFacade,
    private readonly urls: SiteUrls,
  ) {}

  async resolve(rawHost: string): Promise<string | null> {
    const host = SiteHostPolicy.normalizeHost(rawHost)
    if (!host || host.length > 253) return null

    const cached = this.cache.get(host)
    if (cached && cached.expires > Date.now()) return cached.slug

    const slug = await this.lookup(host)
    if (this.cache.size >= MAX_ENTRIES) this.cache.clear()
    this.cache.set(host, {
      slug,
      expires: Date.now() + (slug ? HIT_TTL_MS : MISS_TTL_MS),
    })
    return slug
  }

  /** Olvida lo cacheado (tras cambiar un dominio o despublicar). */
  invalidate(): void {
    this.cache.clear()
  }

  private async lookup(host: string): Promise<string | null> {
    const subdomain = SiteHostPolicy.subdomainOf(host, this.urls.baseDomain)
    // Coincidencia EXACTA. El TXT de verificación prueba el control de un nombre
    // concreto: quien verificó `www.foo.com` no demostró controlar `foo.com`
    // (pueden ser de personas distintas), así que uno no resuelve al otro. Si
    // la inmobiliaria quiere los dos, carga y verifica los dos.
    const found = await this.settings.findPublishedByHost(
      subdomain ? { subdomain } : { customDomain: host },
    )
    if (!found) return null
    const tenant = await this.tenants.findActiveById(found.tenantId)
    return tenant ? tenant.slug : null
  }
}
