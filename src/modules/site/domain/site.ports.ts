import { SiteSettingsDraft, SiteTemplateKey } from './site.types'

/** La fila de configuración del sitio de una inmobiliaria. */
export interface SiteSettingsRecord {
  id: string
  tenantId: string
  enabled: boolean
  templateKey: SiteTemplateKey
  subdomain: string | null
  customDomain: string | null
  /** Cuándo se verificó el dominio propio; null = reservado pero sin verificar. */
  customDomainVerifiedAt: Date | null
  draft: SiteSettingsDraft
  published: SiteSettingsDraft | null
  publishedAt: Date | null
  updatedAt: Date
}

export interface SiteSettingsChanges {
  enabled?: boolean
  templateKey?: SiteTemplateKey
  subdomain?: string | null
  customDomain?: string | null
  customDomainVerifiedAt?: Date | null
  draft?: SiteSettingsDraft
  published?: SiteSettingsDraft | null
  publishedAt?: Date | null
  publishedById?: string | null
}

/** Dentro del tenant del contexto, salvo lo que dice `unscoped`. */
export abstract class SiteSettingsRepository {
  abstract findCurrent(): Promise<SiteSettingsRecord | null>

  abstract create(data: {
    templateKey: SiteTemplateKey
    draft: SiteSettingsDraft
  }): Promise<SiteSettingsRecord>

  abstract update(
    id: string,
    changes: SiteSettingsChanges,
  ): Promise<SiteSettingsRecord>

  /** Entre todas las inmobiliarias: ¿otra ya tiene ese subdominio? */
  abstract subdomainTakenByOther(subdomain: string): Promise<boolean>

  /** Entre todas las inmobiliarias: ¿otra ya tiene ese dominio VERIFICADO? */
  abstract domainTakenByOther(domain: string): Promise<boolean>

  /**
   * Sin tenant en el contexto (el público no tiene sesión): el sitio
   * publicado y habilitado que corresponde a un subdominio o dominio propio.
   */
  abstract findPublishedByHost(
    by: { subdomain: string } | { customDomain: string },
  ): Promise<{ tenantId: string } | null>
}

export interface NewSiteAsset {
  storageKey: string
  url: string
  contentType: string
  sizeBytes: number
  width: number | null
  height: number | null
}

export interface SiteAssetRecord extends NewSiteAsset {
  id: string
}

export abstract class SiteAssetRepository {
  abstract create(data: NewSiteAsset): Promise<SiteAssetRecord>

  abstract count(): Promise<number>

  /** De esas URLs, las que son imágenes subidas por esta inmobiliaria. */
  abstract existingUrls(urls: string[]): Promise<Set<string>>
}

/**
 * Consulta de registros TXT del DNS, para verificar que un dominio propio es de
 * quien lo reclama. Puerto para poder reemplazarlo en los tests.
 */
export abstract class DnsTxtPort {
  /** Los valores TXT del host; vacío si no existe o el DNS no responde. */
  abstract resolveTxt(host: string): Promise<string[]>
}

/** Avisa a `apps/sites` que un sitio cambió, para que lo vuelva a armar ya. */
export abstract class SiteRevalidationPort {
  /** No lanza: si el aviso falla, el sitio se actualiza solo al vencer el caché. */
  abstract revalidate(slug: string): Promise<void>
}
