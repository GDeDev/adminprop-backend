import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

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
  reducedFeeThreshold: true,
  standardFeePercentage: true,
  reducedFeePercentage: true,
  contractExpiryNoticeDays: true,
  paymentGraceDays: true,
  dailyLateFeePercentage: true,
  installmentGenerationDay: true,
  paymentReminderDay: true,
  monthlyReportDay: true,
} as const

type TenantRow = Prisma.TenantGetPayload<{ select: typeof TENANT_FIELDS }>

@Injectable()
export class TenantRepositoryImpl extends TenantRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async findById(id: string): Promise<Tenant | null> {
    const row = await this.prisma.db.tenant.findUnique({
      where: { id },
      select: TENANT_FIELDS,
    })
    return row ? toDomain(row) : null
  }

  async listActive(): Promise<Tenant[]> {
    const rows = await this.prisma.db.tenant.findMany({
      where: { isActive: true },
      select: TENANT_FIELDS,
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(toDomain)
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.prisma.db.tenant.findUnique({
      where: { slug: slug.trim().toLowerCase() },
      select: TENANT_FIELDS,
    })
    return row ? toDomain(row) : null
  }
}

/** Los porcentajes salen como string: son decimales, nunca `number`. */
function toDomain(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logoUrl,
    primaryColor: row.primaryColor,
    isActive: row.isActive,
    reducedFeeThreshold: row.reducedFeeThreshold,
    standardFeePercentage: row.standardFeePercentage.toFixed(2),
    reducedFeePercentage: row.reducedFeePercentage.toFixed(2),
    contractExpiryNoticeDays: row.contractExpiryNoticeDays,
    paymentGraceDays: row.paymentGraceDays,
    dailyLateFeePercentage: row.dailyLateFeePercentage.toFixed(2),
    installmentGenerationDay: row.installmentGenerationDay,
    paymentReminderDay: row.paymentReminderDay,
    monthlyReportDay: row.monthlyReportDay,
  }
}
