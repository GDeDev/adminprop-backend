import { Injectable } from '@nestjs/common'

import { Tenant } from '@/modules/tenants/domain/tenant.entity'
import { TenantRepository } from '@/modules/tenants/domain/tenant.repository'
import { PrismaService } from '@/shared/prisma/prisma.service'

/** Lo único que se lee de `tenants`: nunca la fila entera. */
const TENANT_FIELDS = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  primaryColor: true,
  isActive: true,
} as const

@Injectable()
export class TenantRepositoryImpl extends TenantRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  findById(id: string): Promise<Tenant | null> {
    return this.prisma.db.tenant.findUnique({
      where: { id },
      select: TENANT_FIELDS,
    })
  }

  findBySlug(slug: string): Promise<Tenant | null> {
    return this.prisma.db.tenant.findUnique({
      where: { slug: slug.trim().toLowerCase() },
      select: TENANT_FIELDS,
    })
  }
}
