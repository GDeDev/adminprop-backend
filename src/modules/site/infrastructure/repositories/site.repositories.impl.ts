import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { RequestContext } from '@/shared/context/request-context'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  NewSiteAsset,
  SiteAssetRecord,
  SiteAssetRepository,
  SiteSettingsChanges,
  SiteSettingsRecord,
  SiteSettingsRepository,
} from '../../domain/site.ports'
import { SiteSettingsDraft, SiteTemplateKey } from '../../domain/site.types'

type Row = Prisma.SiteSettingsGetPayload<object>

const json = (draft: SiteSettingsDraft) =>
  draft as unknown as Prisma.InputJsonValue

function toRecord(row: Row): SiteSettingsRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    enabled: row.enabled,
    templateKey: row.templateKey as SiteTemplateKey,
    subdomain: row.subdomain,
    customDomain: row.customDomain,
    customDomainVerifiedAt: row.customDomainVerifiedAt,
    draft: row.draft as unknown as SiteSettingsDraft,
    published: row.published as unknown as SiteSettingsDraft | null,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  }
}

@Injectable()
export class SiteSettingsRepositoryImpl extends SiteSettingsRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async findCurrent(): Promise<SiteSettingsRecord | null> {
    const row = await this.prisma.db.siteSettings.findFirst()
    return row ? toRecord(row) : null
  }

  async create(data: {
    templateKey: SiteTemplateKey
    draft: SiteSettingsDraft
  }): Promise<SiteSettingsRecord> {
    // Sin tenantId: lo completa la extensión de tenant (de ahí el cast).
    const row = await this.prisma.db.siteSettings.create({
      data: {
        templateKey: data.templateKey,
        draft: json(data.draft),
      } as Prisma.SiteSettingsUncheckedCreateInput,
    })
    return toRecord(row)
  }

  async update(
    id: string,
    changes: SiteSettingsChanges,
  ): Promise<SiteSettingsRecord> {
    const { draft, published, ...scalars } = changes
    const row = await this.prisma.db.siteSettings.update({
      where: { id },
      data: {
        ...scalars,
        ...(draft ? { draft: json(draft) } : {}),
        ...(published === undefined
          ? {}
          : { published: published ? json(published) : Prisma.DbNull }),
      },
    })
    return toRecord(row)
  }

  // Las dos búsquedas de unicidad cruzan inmobiliarias a propósito: el
  // subdominio y el dominio son únicos en todo el sistema.
  async subdomainTakenByOther(subdomain: string): Promise<boolean> {
    return this.takenByOther({ subdomain })
  }

  async domainTakenByOther(domain: string): Promise<boolean> {
    // Solo cuentan los verificados: reservar sin demostrar no bloquea a nadie.
    return this.takenByOther({
      customDomain: domain,
      customDomainVerifiedAt: { not: null },
    })
  }

  private async takenByOther(
    where: Prisma.SiteSettingsWhereInput,
  ): Promise<boolean> {
    const own = RequestContext.tenantId
    const count = await this.prisma.unscoped.siteSettings.count({
      where: { ...where, ...(own ? { NOT: { tenantId: own } } : {}) },
    })
    return count > 0
  }

  async findPublishedByHost(
    by: { subdomain: string } | { customDomain: string },
  ): Promise<{ tenantId: string } | null> {
    const row = await this.prisma.unscoped.siteSettings.findFirst({
      where: {
        ...by,
        // Un dominio propio resuelve solo si está verificado.
        ...('customDomain' in by
          ? { customDomainVerifiedAt: { not: null } }
          : {}),
        enabled: true,
        published: { not: Prisma.DbNull },
      },
      select: { tenantId: true },
    })
    return row
  }
}

@Injectable()
export class SiteAssetRepositoryImpl extends SiteAssetRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async create(data: NewSiteAsset): Promise<SiteAssetRecord> {
    const row = await this.prisma.db.siteAsset.create({
      data: data as Prisma.SiteAssetUncheckedCreateInput,
    })
    return { ...data, id: row.id }
  }

  count(): Promise<number> {
    return this.prisma.db.siteAsset.count()
  }

  async existingUrls(urls: string[]): Promise<Set<string>> {
    if (urls.length === 0) return new Set()
    const rows = await this.prisma.db.siteAsset.findMany({
      where: { url: { in: urls } },
      select: { url: true },
    })
    return new Set(rows.map((r) => r.url))
  }
}
