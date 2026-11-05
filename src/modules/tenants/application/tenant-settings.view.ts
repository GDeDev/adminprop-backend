import { Tenant } from '../domain/tenant.entity'

/** La configuración de la inmobiliaria (`TenantSettingsDto`, Fase 15, 7). */
export interface TenantSettingsView {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  primaryColor: string | null
  legalName: string | null
  taxId: string | null
  address: string | null
  phone: string | null
  email: string | null
  whatsapp: string | null
  bankAccountHolder: string | null
  bankName: string | null
  bankCbu: string | null
  bankAlias: string | null
  documentFooter: string | null
  /** Parámetros de cobro (D-228). */
  dailyLateFeePercentage: string | null
  paymentGraceDays: number
  /** Saldo a favor: se aplica solo al generar la cuota (D-237). */
  autoApplyCreditOnGeneration: boolean
  /** Día del mes desde el que corre el punitorio por defecto (gracia + 1). */
  lateFeeStartDay: number
  receiptSequence: number
}

export function toTenantSettingsView(tenant: Tenant): TenantSettingsView {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
    legalName: tenant.legalName,
    taxId: tenant.taxId,
    address: tenant.address,
    phone: tenant.phone,
    email: tenant.email,
    whatsapp: tenant.whatsapp,
    bankAccountHolder: tenant.bankAccountHolder,
    bankName: tenant.bankName,
    bankCbu: tenant.bankCbu,
    bankAlias: tenant.bankAlias,
    documentFooter: tenant.documentFooter,
    dailyLateFeePercentage: tenant.dailyLateFeePercentage,
    paymentGraceDays: tenant.paymentGraceDays,
    autoApplyCreditOnGeneration: tenant.autoApplyCreditOnGeneration,
    lateFeeStartDay: tenant.paymentGraceDays + 1,
    receiptSequence: tenant.receiptSequence,
  }
}
