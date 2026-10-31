import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import {
  Tenant,
  TenantSettingsPatch,
} from '@/modules/tenants/domain/tenant.entity'
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
  legalName: true,
  taxId: true,
  address: true,
  phone: true,
  email: true,
  whatsapp: true,
  bankAccountHolder: true,
  bankName: true,
  bankCbu: true,
  bankAlias: true,
  documentFooter: true,
  logoKey: true,
  receiptSequence: true,
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

  async updateSettings(
    id: string,
    patch: TenantSettingsPatch,
  ): Promise<Tenant> {
    // `undefined` no toca la columna; `null` la borra. Con auditoría: queda
    // quién cambió qué.
    const row = await this.prisma.db.tenant.update({
      where: { id },
      data: patch,
      select: TENANT_FIELDS,
    })
    return toDomain(row)
  }

  async setLogo(
    id: string,
    logo: { key: string; url: string } | null,
  ): Promise<Tenant> {
    const row = await this.prisma.db.tenant.update({
      where: { id },
      data: { logoKey: logo?.key ?? null, logoUrl: logo?.url ?? null },
      select: TENANT_FIELDS,
    })
    return toDomain(row)
  }

  async nextReceiptNumber(id: string): Promise<number> {
    // SQL directo: el contador se mueve en cada recibo y auditar cada
    // incremento llenaría el historial de ruido. El UPDATE es atómico.
    const rows = await this.prisma.db.$queryRaw<{ receipt_sequence: number }[]>`
      UPDATE tenants SET receipt_sequence = receipt_sequence + 1
      WHERE id = ${id}::uuid
      RETURNING receipt_sequence
    `
    if (rows.length === 0) throw new Error(`Tenant inexistente: ${id}`)
    return rows[0].receipt_sequence
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
    legalName: row.legalName,
    taxId: row.taxId,
    address: row.address,
    phone: row.phone,
    email: row.email,
    whatsapp: row.whatsapp,
    bankAccountHolder: row.bankAccountHolder,
    bankName: row.bankName,
    bankCbu: row.bankCbu,
    bankAlias: row.bankAlias,
    documentFooter: row.documentFooter,
    logoKey: row.logoKey,
    receiptSequence: row.receiptSequence,
  }
}
