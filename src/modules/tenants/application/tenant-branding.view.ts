import { Tenant } from '../domain/tenant.entity'

/**
 * Lo que el front necesita para pintar la marca de la inmobiliaria y los datos
 * de contacto que muestran los portales (Fase 15, 7).
 */
export interface TenantBrandingView {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  /** Hex (`#1a2b3c`). El front lo aplica sobre `--primary`. */
  primaryColor: string | null
  whatsapp: string | null
  phone: string | null
  email: string | null
  address: string | null
}

export function toTenantBrandingView(tenant: Tenant): TenantBrandingView {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
    whatsapp: tenant.whatsapp,
    phone: tenant.phone,
    email: tenant.email,
    address: tenant.address,
  }
}
